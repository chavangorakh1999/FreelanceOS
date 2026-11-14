-- CreateEnum
CREATE TYPE "SignatureKind" AS ENUM ('TYPED', 'DRAWN', 'UPLOADED');

-- AlterEnum
ALTER TYPE "SignatureMethod" ADD VALUE 'IN_APP';

-- AlterTable
ALTER TABLE "signature_events" ADD COLUMN     "signatureKind" "SignatureKind",
ADD COLUMN     "signatureSha256" TEXT,
ADD COLUMN     "signatureStorageKey" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "assigneeContactId" UUID,
ADD COLUMN     "assigneeUserId" UUID,
ADD COLUMN     "number" INTEGER;

-- Existing tasks get keys in the order they were created, per project; then the key becomes required.
UPDATE "tasks" t SET "number" = n.rn FROM (SELECT "id", row_number() OVER (PARTITION BY "projectId" ORDER BY "createdAt", "id") AS rn FROM "tasks") n WHERE n."id" = t."id";
ALTER TABLE "tasks" ALTER COLUMN "number" SET NOT NULL;

-- CreateIndex
CREATE INDEX "tasks_workspaceId_assigneeUserId_idx" ON "tasks"("workspaceId", "assigneeUserId");

-- CreateIndex
CREATE INDEX "tasks_assigneeContactId_idx" ON "tasks"("assigneeContactId");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_projectId_number_key" ON "tasks"("projectId", "number");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeContactId_fkey" FOREIGN KEY ("assigneeContactId") REFERENCES "client_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────── integrity rules ─────────

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_one_assignee" CHECK (num_nonnulls("assigneeUserId", "assigneeContactId") <= 1);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_number_positive" CHECK ("number" > 0);
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_image_complete" CHECK (("signatureStorageKey" IS NULL) = ("signatureSha256" IS NULL));

-- An assignee must belong to the work: a member of the workspace, or a contact of the project's own client.
CREATE OR REPLACE FUNCTION tasks_assignee_scope_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."assigneeUserId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "workspace_memberships" WHERE "userId" = NEW."assigneeUserId" AND "workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'the assignee is not a member of this workspace' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."assigneeContactId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "client_contacts" c JOIN "projects" p ON p."clientId" = c."clientId"
     WHERE c."id" = NEW."assigneeContactId" AND p."id" = NEW."projectId" AND c."workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'a client assignee must be a contact of this project''s client' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tasks_assignee_scope BEFORE INSERT OR UPDATE OF "assigneeUserId", "assigneeContactId" ON "tasks" FOR EACH ROW EXECUTE FUNCTION tasks_assignee_scope_guard();

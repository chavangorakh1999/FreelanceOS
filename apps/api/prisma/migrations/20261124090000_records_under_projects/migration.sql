-- AlterTable
ALTER TABLE "agreements" ADD COLUMN     "projectId" UUID;

-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "projectId" UUID;

-- CreateIndex
CREATE INDEX "agreements_projectId_idx" ON "agreements"("projectId");

-- CreateIndex
CREATE INDEX "proposals_projectId_idx" ON "proposals"("projectId");

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: a project's source proposal and agreement belong to it.
UPDATE "proposals" p SET "projectId" = pr."id"
  FROM (SELECT DISTINCT ON ("proposalId") "id", "proposalId" FROM "projects" WHERE "proposalId" IS NOT NULL ORDER BY "proposalId", "createdAt") pr
  WHERE p."id" = pr."proposalId";
UPDATE "agreements" a SET "projectId" = pr."id"
  FROM (SELECT DISTINCT ON ("agreementId") "id", "agreementId" FROM "projects" WHERE "agreementId" IS NOT NULL ORDER BY "agreementId", "createdAt") pr
  WHERE a."id" = pr."agreementId";

-- A proposal or agreement can only sit in a project of the same workspace and client.
CREATE OR REPLACE FUNCTION records_project_scope_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."projectId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "projects" WHERE "id" = NEW."projectId" AND "workspaceId" = NEW."workspaceId" AND "clientId" = NEW."clientId"
  ) THEN
    RAISE EXCEPTION 'project must belong to the same workspace and client' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER proposals_project_scope BEFORE INSERT OR UPDATE OF "projectId", "clientId" ON "proposals" FOR EACH ROW EXECUTE FUNCTION records_project_scope_guard();
CREATE TRIGGER agreements_project_scope BEFORE INSERT OR UPDATE OF "projectId", "clientId" ON "agreements" FOR EACH ROW EXECUTE FUNCTION records_project_scope_guard();

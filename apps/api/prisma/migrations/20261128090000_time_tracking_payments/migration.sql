-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'PAYMENT_NOTICE';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "hourlyRateCurrency" CHAR(3),
ADD COLUMN     "hourlyRateMinor" BIGINT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "paymentLinkTemplate" TEXT,
ADD COLUMN     "upiId" TEXT;

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "taskId" UUID,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "runningSince" TIMESTAMPTZ,
    "invoiceId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_entries_workspaceId_projectId_date_idx" ON "time_entries"("workspaceId", "projectId", "date");

-- CreateIndex
CREATE INDEX "time_entries_invoiceId_idx" ON "time_entries"("invoiceId");

-- CreateIndex
CREATE INDEX "time_entries_userId_runningSince_idx" ON "time_entries"("userId", "runningSince");

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hours are whole minutes within a day; a running timer has no minutes yet.
ALTER TABLE "time_entries" ADD CONSTRAINT "time_minutes_range" CHECK ("minutes" >= 0 AND "minutes" <= 1440);
ALTER TABLE "time_entries" ADD CONSTRAINT "time_running_unbilled" CHECK ("runningSince" IS NULL OR "invoiceId" IS NULL);
-- One running timer per person.
CREATE UNIQUE INDEX "time_one_running_per_user" ON "time_entries"("userId") WHERE "runningSince" IS NOT NULL;
ALTER TABLE "projects" ADD CONSTRAINT "projects_rate_currency" CHECK (("hourlyRateMinor" IS NULL) = ("hourlyRateCurrency" IS NULL));

-- An entry belongs to a project of its workspace; its task (if any) to that project; its invoice to that project's client.
CREATE OR REPLACE FUNCTION time_entries_scope_guard() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "projects" WHERE "id" = NEW."projectId" AND "workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'time entry project must be in the same workspace' USING ERRCODE = '23514';
  END IF;
  IF NEW."taskId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "tasks" WHERE "id" = NEW."taskId" AND "projectId" = NEW."projectId") THEN
    RAISE EXCEPTION 'time entry task must belong to its project' USING ERRCODE = '23514';
  END IF;
  IF NEW."invoiceId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "invoices" i JOIN "projects" p ON p."id" = NEW."projectId" WHERE i."id" = NEW."invoiceId" AND i."workspaceId" = NEW."workspaceId" AND i."clientId" = p."clientId"
  ) THEN
    RAISE EXCEPTION 'time entry invoice must be for the project client' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER time_entries_scope BEFORE INSERT OR UPDATE ON "time_entries" FOR EACH ROW EXECUTE FUNCTION time_entries_scope_guard();

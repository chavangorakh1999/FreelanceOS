-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('CONTRACT', 'BRIEF', 'DESIGN', 'DELIVERABLE', 'FINANCE', 'CORRESPONDENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentAccessAction" AS ENUM ('DOWNLOAD');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'DOCUMENT_SHARED';

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "clientId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
    "visibility" "Visibility" NOT NULL DEFAULT 'INTERNAL',
    "sharedAt" TIMESTAMPTZ,
    "createdById" UUID NOT NULL,
    "archivedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "note" TEXT,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_links" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "engagementId" UUID,
    "proposalId" UUID,
    "agreementId" UUID,
    "projectId" UUID,
    "changeRequestId" UUID,
    "invoiceId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_access_logs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "userId" UUID,
    "portalUserId" UUID,
    "action" "DocumentAccessAction" NOT NULL DEFAULT 'DOWNLOAD',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_workspaceId_clientId_idx" ON "documents"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "documents_workspaceId_archivedAt_updatedAt_idx" ON "documents"("workspaceId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_storageKey_key" ON "document_versions"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_versionNumber_key" ON "document_versions"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "document_links_documentId_idx" ON "document_links"("documentId");

-- CreateIndex
CREATE INDEX "document_links_projectId_idx" ON "document_links"("projectId");

-- CreateIndex
CREATE INDEX "document_access_logs_documentId_createdAt_idx" ON "document_access_logs"("documentId", "createdAt");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────── integrity rules the application must not be able to bypass ─────────

-- A document can be shared only once it belongs to a client; a link names exactly one record.
ALTER TABLE "documents" ADD CONSTRAINT "documents_shared_needs_client" CHECK ("visibility" = 'INTERNAL' OR "clientId" IS NOT NULL);
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_size_positive" CHECK ("sizeBytes" > 0 AND "versionNumber" > 0);
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_one_target" CHECK (
  num_nonnulls("engagementId", "proposalId", "agreementId", "projectId", "changeRequestId", "invoiceId") = 1);
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_one_actor" CHECK (num_nonnulls("userId", "portalUserId") = 1);

-- The same document is linked to the same record once.
CREATE UNIQUE INDEX "document_links_engagement_once" ON "document_links" ("documentId", "engagementId") WHERE "engagementId" IS NOT NULL;
CREATE UNIQUE INDEX "document_links_proposal_once" ON "document_links" ("documentId", "proposalId") WHERE "proposalId" IS NOT NULL;
CREATE UNIQUE INDEX "document_links_agreement_once" ON "document_links" ("documentId", "agreementId") WHERE "agreementId" IS NOT NULL;
CREATE UNIQUE INDEX "document_links_project_once" ON "document_links" ("documentId", "projectId") WHERE "projectId" IS NOT NULL;
CREATE UNIQUE INDEX "document_links_change_once" ON "document_links" ("documentId", "changeRequestId") WHERE "changeRequestId" IS NOT NULL;
CREATE UNIQUE INDEX "document_links_invoice_once" ON "document_links" ("documentId", "invoiceId") WHERE "invoiceId" IS NOT NULL;

-- Versions and the access log are history: never edited, never deleted.
CREATE TRIGGER document_versions_append_only BEFORE UPDATE OR DELETE ON "document_versions" FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER document_access_logs_append_only BEFORE UPDATE OR DELETE ON "document_access_logs" FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- A version and a log row belong to their document's workspace.
CREATE OR REPLACE FUNCTION document_children_scope_guard() RETURNS trigger AS $$
DECLARE d "documents"%ROWTYPE;
BEGIN
  SELECT * INTO d FROM "documents" WHERE "id" = NEW."documentId";
  IF d."workspaceId" <> NEW."workspaceId" THEN
    RAISE EXCEPTION 'the document belongs to another workspace' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER document_versions_scope BEFORE INSERT ON "document_versions" FOR EACH ROW EXECUTE FUNCTION document_children_scope_guard();
CREATE TRIGGER document_access_logs_scope BEFORE INSERT ON "document_access_logs" FOR EACH ROW EXECUTE FUNCTION document_children_scope_guard();

-- A link may only reach a record in the document's workspace and, when the document has a client, that client's records.
CREATE OR REPLACE FUNCTION document_links_scope_guard() RETURNS trigger AS $$
DECLARE d "documents"%ROWTYPE; ws uuid; cl uuid;
BEGIN
  SELECT * INTO d FROM "documents" WHERE "id" = NEW."documentId";
  IF NEW."engagementId" IS NOT NULL THEN SELECT "workspaceId", "clientId" INTO ws, cl FROM "engagements" WHERE "id" = NEW."engagementId";
  ELSIF NEW."proposalId" IS NOT NULL THEN SELECT "workspaceId", "clientId" INTO ws, cl FROM "proposals" WHERE "id" = NEW."proposalId";
  ELSIF NEW."agreementId" IS NOT NULL THEN SELECT "workspaceId", "clientId" INTO ws, cl FROM "agreements" WHERE "id" = NEW."agreementId";
  ELSIF NEW."projectId" IS NOT NULL THEN SELECT "workspaceId", "clientId" INTO ws, cl FROM "projects" WHERE "id" = NEW."projectId";
  ELSIF NEW."changeRequestId" IS NOT NULL THEN SELECT cr."workspaceId", p."clientId" INTO ws, cl FROM "change_requests" cr JOIN "projects" p ON p."id" = cr."projectId" WHERE cr."id" = NEW."changeRequestId";
  ELSE SELECT "workspaceId", "clientId" INTO ws, cl FROM "invoices" WHERE "id" = NEW."invoiceId";
  END IF;
  IF ws IS DISTINCT FROM d."workspaceId" OR NEW."workspaceId" <> d."workspaceId" THEN
    RAISE EXCEPTION 'a document can only be linked to records in its own workspace' USING ERRCODE = 'restrict_violation';
  END IF;
  IF d."clientId" IS NOT NULL AND cl IS DISTINCT FROM d."clientId" THEN
    RAISE EXCEPTION 'a client''s document can only be linked to that client''s records' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER document_links_scope BEFORE INSERT OR UPDATE ON "document_links" FOR EACH ROW EXECUTE FUNCTION document_links_scope_guard();

-- Moving a document to another client must not leave links pointing at the previous client's records.
CREATE OR REPLACE FUNCTION documents_client_change_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."clientId" IS DISTINCT FROM OLD."clientId" AND EXISTS (SELECT 1 FROM "document_links" WHERE "documentId" = NEW."id") THEN
    RAISE EXCEPTION 'remove the document''s links before changing its client' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."workspaceId" <> OLD."workspaceId" THEN
    RAISE EXCEPTION 'a document cannot move between workspaces' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER documents_client_change BEFORE UPDATE ON "documents" FOR EACH ROW EXECUTE FUNCTION documents_client_change_guard();

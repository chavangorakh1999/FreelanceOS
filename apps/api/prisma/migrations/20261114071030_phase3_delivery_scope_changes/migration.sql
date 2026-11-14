-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('INTERNAL', 'CLIENT_VISIBLE', 'SHARED_WITH_SELECTED_CONTACTS');

-- CreateEnum
CREATE TYPE "ScopeVersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ScopeItemKind" AS ENUM ('REQUIREMENT', 'FEATURE', 'DELIVERABLE', 'ASSUMPTION', 'EXCLUSION', 'ACCEPTANCE_CRITERION');

-- CreateEnum
CREATE TYPE "ScopeDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DELIVERED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('SUBMITTED', 'NEEDS_CLARIFICATION', 'ASSESSED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "RequesterType" AS ENUM ('FREELANCER', 'CLIENT');

-- CreateEnum
CREATE TYPE "AddendumStatus" AS ENUM ('NOT_REQUIRED', 'REQUIRED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ChangeParty" AS ENUM ('FREELANCER', 'CLIENT');

-- CreateEnum
CREATE TYPE "ChangeDecisionKind" AS ENUM ('APPROVED', 'REJECTED', 'CLARIFICATION_REQUESTED');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "engagementId" UUID,
    "proposalId" UUID,
    "agreementId" UUID,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "startDate" DATE,
    "targetDate" DATE,
    "ownerId" UUID NOT NULL,
    "visibility" "Visibility" NOT NULL DEFAULT 'INTERNAL',
    "archivedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_documents" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scope_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "scopeDocumentId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "ScopeVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "submittedAt" TIMESTAMPTZ,
    "approvedAt" TIMESTAMPTZ,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scope_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_items" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "itemKey" UUID NOT NULL,
    "kind" "ScopeItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,

    CONSTRAINT "scope_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_approvals" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "decision" "ScopeDecision" NOT NULL,
    "channel" "DecisionChannel" NOT NULL DEFAULT 'OTHER',
    "approverName" TEXT,
    "decidedAt" TIMESTAMPTZ NOT NULL,
    "recordedById" UUID NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scope_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" DATE,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "position" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_deliverables" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "milestoneId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scopeItemKey" UUID,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "milestone_deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "milestoneId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "internalNotes" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "dueDate" DATE,
    "position" INTEGER NOT NULL DEFAULT 0,
    "visibility" "Visibility" NOT NULL DEFAULT 'INTERNAL',
    "completedAt" TIMESTAMPTZ,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "dependsOnTaskId" UUID NOT NULL,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedBy" "RequesterType" NOT NULL,
    "requesterName" TEXT,
    "requestedAt" DATE NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "baseScopeVersionId" UUID NOT NULL,
    "resultingScopeVersionId" UUID,
    "addendumStatus" "AddendumStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "addendumNote" TEXT,
    "addendumAgreementId" UUID,
    "addendumCompletedAt" TIMESTAMPTZ,
    "withdrawnReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_request_assessments" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "changeRequestId" UUID NOT NULL,
    "costDeltaMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timelineDeltaDays" INTEGER NOT NULL,
    "deliverablesImpact" TEXT NOT NULL,
    "dependenciesImpact" TEXT NOT NULL,
    "risk" "RiskLevel" NOT NULL,
    "riskNotes" TEXT,
    "requiresAddendum" BOOLEAN NOT NULL,
    "assessedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_request_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_request_decisions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "changeRequestId" UUID NOT NULL,
    "party" "ChangeParty" NOT NULL,
    "decision" "ChangeDecisionKind" NOT NULL,
    "channel" "DecisionChannel" NOT NULL DEFAULT 'OTHER',
    "decidedAt" TIMESTAMPTZ NOT NULL,
    "recordedById" UUID NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_request_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_workspaceId_clientId_idx" ON "projects"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "projects_workspaceId_status_idx" ON "projects"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_workspaceId_number_key" ON "projects"("workspaceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "scope_documents_projectId_key" ON "scope_documents"("projectId");

-- CreateIndex
CREATE INDEX "scope_versions_workspaceId_scopeDocumentId_idx" ON "scope_versions"("workspaceId", "scopeDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "scope_versions_scopeDocumentId_versionNumber_key" ON "scope_versions"("scopeDocumentId", "versionNumber");

-- CreateIndex
CREATE INDEX "scope_items_versionId_position_idx" ON "scope_items"("versionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "scope_approvals_versionId_key" ON "scope_approvals"("versionId");

-- CreateIndex
CREATE INDEX "milestones_workspaceId_projectId_position_idx" ON "milestones"("workspaceId", "projectId", "position");

-- CreateIndex
CREATE INDEX "milestone_deliverables_milestoneId_position_idx" ON "milestone_deliverables"("milestoneId", "position");

-- CreateIndex
CREATE INDEX "tasks_workspaceId_projectId_status_idx" ON "tasks"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE INDEX "tasks_projectId_milestoneId_position_idx" ON "tasks"("projectId", "milestoneId", "position");

-- CreateIndex
CREATE INDEX "task_dependencies_dependsOnTaskId_idx" ON "task_dependencies"("dependsOnTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_taskId_dependsOnTaskId_key" ON "task_dependencies"("taskId", "dependsOnTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_resultingScopeVersionId_key" ON "change_requests"("resultingScopeVersionId");

-- CreateIndex
CREATE INDEX "change_requests_workspaceId_projectId_status_idx" ON "change_requests"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_projectId_number_key" ON "change_requests"("projectId", "number");

-- CreateIndex
CREATE INDEX "change_request_assessments_changeRequestId_createdAt_idx" ON "change_request_assessments"("changeRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "change_request_decisions_changeRequestId_createdAt_idx" ON "change_request_decisions"("changeRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_documents" ADD CONSTRAINT "scope_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_scopeDocumentId_fkey" FOREIGN KEY ("scopeDocumentId") REFERENCES "scope_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "scope_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_approvals" ADD CONSTRAINT "scope_approvals_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "scope_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_deliverables" ADD CONSTRAINT "milestone_deliverables_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_baseScopeVersionId_fkey" FOREIGN KEY ("baseScopeVersionId") REFERENCES "scope_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_resultingScopeVersionId_fkey" FOREIGN KEY ("resultingScopeVersionId") REFERENCES "scope_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request_assessments" ADD CONSTRAINT "change_request_assessments_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request_decisions" ADD CONSTRAINT "change_request_decisions_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Scope control and change-management guarantees (PRD §7.7, §7.9, App. B #6-8) ─────────────

-- One working draft, at most one version under review, and exactly one live baseline per scope document.
CREATE UNIQUE INDEX "scope_versions_one_draft"     ON "scope_versions" ("scopeDocumentId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "scope_versions_one_in_review" ON "scope_versions" ("scopeDocumentId") WHERE "status" = 'IN_REVIEW';
CREATE UNIQUE INDEX "scope_versions_one_approved"  ON "scope_versions" ("scopeDocumentId") WHERE "status" = 'APPROVED';

-- A scope version is editable only while DRAFT. After that only its status (and approval timestamp) may advance.
CREATE OR REPLACE FUNCTION scope_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'scope version % is % and cannot be deleted', OLD."versionNumber", OLD."status" USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    IF NEW."status" NOT IN ('DRAFT', 'IN_REVIEW') THEN
      RAISE EXCEPTION 'a draft scope version can only be submitted for review, not %', NEW."status" USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'approvedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'approvedAt') THEN
    RAISE EXCEPTION 'scope version content is frozen once submitted (version %)', OLD."versionNumber" USING ERRCODE = 'restrict_violation';
  END IF;

  IF NOT (
    OLD."status" = NEW."status"
    OR (OLD."status" = 'IN_REVIEW' AND NEW."status" IN ('APPROVED', 'CHANGES_REQUESTED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" = 'SUPERSEDED')
    OR (OLD."status" = 'CHANGES_REQUESTED' AND NEW."status" = 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'illegal scope version transition % -> %', OLD."status", NEW."status" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scope_versions_guard_trg BEFORE UPDATE OR DELETE ON "scope_versions"
  FOR EACH ROW EXECUTE FUNCTION scope_versions_guard();

CREATE OR REPLACE FUNCTION scope_items_guard() RETURNS trigger AS $$
DECLARE vid uuid; vstatus text;
BEGIN
  IF TG_OP = 'DELETE' THEN vid := OLD."versionId"; ELSE vid := NEW."versionId"; END IF;
  SELECT "status"::text INTO vstatus FROM "scope_versions" WHERE "id" = vid;
  IF vstatus IS NOT NULL AND vstatus <> 'DRAFT' THEN
    RAISE EXCEPTION '% on scope_items rejected: scope version is % (frozen; change it through an approved change request)', TG_OP, vstatus USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scope_items_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON "scope_items"
  FOR EACH ROW EXECUTE FUNCTION scope_items_guard();

-- Records of fact. (append_only_guard() was created in the Phase 2 migration.)
CREATE TRIGGER scope_approvals_append_only BEFORE UPDATE OR DELETE ON "scope_approvals" FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER change_request_assessments_append_only BEFORE UPDATE OR DELETE ON "change_request_assessments" FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER change_request_decisions_append_only BEFORE UPDATE OR DELETE ON "change_request_decisions" FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- A change request's base scope version is part of its identity: it can never be repointed.
CREATE OR REPLACE FUNCTION change_requests_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."baseScopeVersionId" <> OLD."baseScopeVersionId" OR NEW."projectId" <> OLD."projectId" THEN
    RAISE EXCEPTION 'a change request cannot be moved to another baseline or project' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."resultingScopeVersionId" IS NOT NULL AND NEW."resultingScopeVersionId" IS DISTINCT FROM OLD."resultingScopeVersionId" THEN
    RAISE EXCEPTION 'the resulting scope version of a change request is fixed once created' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER change_requests_guard_trg BEFORE UPDATE ON "change_requests" FOR EACH ROW EXECUTE FUNCTION change_requests_guard();

-- Sanity constraints
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_not_self" CHECK ("taskId" <> "dependsOnTaskId");
ALTER TABLE "change_request_assessments" ADD CONSTRAINT "change_request_assessments_timeline" CHECK ("timelineDeltaDays" BETWEEN -3650 AND 3650);

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('PROPOSAL', 'AGREEMENT');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SHARED', 'ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "ProposalVersionStatus" AS ENUM ('DRAFT', 'SHARED', 'SUPERSEDED', 'ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('FIXED', 'MILESTONE', 'HOURLY', 'DAILY', 'TIME_AND_MATERIALS', 'RETAINER', 'HYBRID');

-- CreateEnum
CREATE TYPE "SectionKind" AS ENUM ('INTRODUCTION', 'SCOPE', 'DELIVERABLES', 'TIMELINE', 'ASSUMPTIONS', 'EXCLUSIONS', 'TERMS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PaymentTermKind" AS ENUM ('UPFRONT', 'MILESTONE', 'ON_COMPLETION', 'NET_DAYS');

-- CreateEnum
CREATE TYPE "DecisionKind" AS ENUM ('ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "DecisionChannel" AS ENUM ('PORTAL', 'EMAIL', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'PARTIALLY_SIGNED', 'SIGNED', 'DECLINED', 'EXPIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AgreementVersionStatus" AS ENUM ('DRAFT', 'SENT', 'SIGNED', 'DECLINED', 'VOID');

-- CreateEnum
CREATE TYPE "SignerRole" AS ENUM ('FREELANCER', 'CLIENT', 'WITNESS');

-- CreateEnum
CREATE TYPE "SignerStatus" AS ENUM ('PENDING', 'SIGNED', 'DECLINED');

-- CreateEnum
CREATE TYPE "SignatureEventType" AS ENUM ('SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'VOIDED');

-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('MANUAL_RECORDED', 'PROVIDER');

-- CreateTable
CREATE TABLE "document_templates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "body" JSONB NOT NULL,
    "archivedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "engagementId" UUID,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "acceptedVersionId" UUID,
    "createdById" UUID NOT NULL,
    "archivedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "ProposalVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "pricingModel" "PricingModel" NOT NULL DEFAULT 'FIXED',
    "validUntil" DATE,
    "summary" TEXT,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "sharedAt" TIMESTAMPTZ,
    "sharedById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_sections" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "SectionKind" NOT NULL DEFAULT 'CUSTOM',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "proposal_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_line_items" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitLabel" TEXT NOT NULL DEFAULT 'unit',
    "unitRateMinor" BIGINT NOT NULL,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "taxBps" INTEGER NOT NULL DEFAULT 0,
    "netMinor" BIGINT NOT NULL,
    "taxMinor" BIGINT NOT NULL,

    CONSTRAINT "proposal_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_payment_terms" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "PaymentTermKind" NOT NULL,
    "percentageBps" INTEGER,
    "amountMinor" BIGINT,
    "dueInDays" INTEGER,

    CONSTRAINT "proposal_payment_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_decisions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "decision" "DecisionKind" NOT NULL,
    "channel" "DecisionChannel" NOT NULL DEFAULT 'OTHER',
    "decidedAt" TIMESTAMPTZ NOT NULL,
    "recordedById" UUID NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreements" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "engagementId" UUID,
    "proposalId" UUID,
    "proposalVersionId" UUID,
    "templateId" UUID,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "expiresAt" DATE,
    "voidReason" TEXT,
    "createdById" UUID NOT NULL,
    "archivedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "AgreementVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "contentHash" TEXT,
    "sentAt" TIMESTAMPTZ,
    "signedAt" TIMESTAMPTZ,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_clauses" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "heading" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "agreement_clauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_signers" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "role" "SignerRole" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contactId" UUID,
    "signingOrder" INTEGER NOT NULL DEFAULT 1,
    "status" "SignerStatus" NOT NULL DEFAULT 'PENDING',
    "signedAt" TIMESTAMPTZ,
    "declinedAt" TIMESTAMPTZ,
    "declineReason" TEXT,

    CONSTRAINT "agreement_signers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_events" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "signerId" UUID,
    "type" "SignatureEventType" NOT NULL,
    "method" "SignatureMethod" NOT NULL DEFAULT 'MANUAL_RECORDED',
    "occurredAt" TIMESTAMPTZ NOT NULL,
    "recordedById" UUID,
    "evidence" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_workspaceId_kind_name_key" ON "document_templates"("workspaceId", "kind", "name");

-- CreateIndex
CREATE INDEX "proposals_workspaceId_clientId_idx" ON "proposals"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "proposals_workspaceId_status_idx" ON "proposals"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_workspaceId_number_key" ON "proposals"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "proposal_versions_workspaceId_proposalId_idx" ON "proposal_versions"("workspaceId", "proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_versions_proposalId_versionNumber_key" ON "proposal_versions"("proposalId", "versionNumber");

-- CreateIndex
CREATE INDEX "proposal_sections_versionId_position_idx" ON "proposal_sections"("versionId", "position");

-- CreateIndex
CREATE INDEX "proposal_line_items_versionId_position_idx" ON "proposal_line_items"("versionId", "position");

-- CreateIndex
CREATE INDEX "proposal_payment_terms_versionId_position_idx" ON "proposal_payment_terms"("versionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_decisions_versionId_key" ON "proposal_decisions"("versionId");

-- CreateIndex
CREATE INDEX "proposal_decisions_workspaceId_proposalId_idx" ON "proposal_decisions"("workspaceId", "proposalId");

-- CreateIndex
CREATE INDEX "agreements_workspaceId_clientId_idx" ON "agreements"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "agreements_workspaceId_status_idx" ON "agreements"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agreements_workspaceId_number_key" ON "agreements"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "agreement_versions_workspaceId_agreementId_idx" ON "agreement_versions"("workspaceId", "agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "agreement_versions_agreementId_versionNumber_key" ON "agreement_versions"("agreementId", "versionNumber");

-- CreateIndex
CREATE INDEX "agreement_clauses_versionId_position_idx" ON "agreement_clauses"("versionId", "position");

-- CreateIndex
CREATE INDEX "agreement_signers_versionId_idx" ON "agreement_signers"("versionId");

-- CreateIndex
CREATE INDEX "signature_events_workspaceId_versionId_occurredAt_idx" ON "signature_events"("workspaceId", "versionId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "signature_events_versionId_idempotencyKey_key" ON "signature_events"("versionId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_acceptedVersionId_fkey" FOREIGN KEY ("acceptedVersionId") REFERENCES "proposal_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_sections" ADD CONSTRAINT "proposal_sections_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "proposal_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_line_items" ADD CONSTRAINT "proposal_line_items_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "proposal_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_payment_terms" ADD CONSTRAINT "proposal_payment_terms_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "proposal_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_decisions" ADD CONSTRAINT "proposal_decisions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_decisions" ADD CONSTRAINT "proposal_decisions_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "proposal_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_proposalVersionId_fkey" FOREIGN KEY ("proposalVersionId") REFERENCES "proposal_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_versions" ADD CONSTRAINT "agreement_versions_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_clauses" ADD CONSTRAINT "agreement_clauses_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_signers" ADD CONSTRAINT "agreement_signers_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "agreement_signers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Immutability and integrity guarantees (PRD §7.5, §7.6, App. B #4-5) ─────────────

-- One working draft and at most one live (shared) version per proposal.
CREATE UNIQUE INDEX "proposal_versions_one_draft" ON "proposal_versions" ("proposalId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "proposal_versions_one_shared" ON "proposal_versions" ("proposalId") WHERE "status" = 'SHARED';
CREATE UNIQUE INDEX "agreement_versions_one_open" ON "agreement_versions" ("agreementId") WHERE "status" IN ('DRAFT', 'SENT');

-- Proposal versions: free while DRAFT; once shared the content is frozen and only the status may advance.
CREATE OR REPLACE FUNCTION proposal_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'proposal version % is % and cannot be deleted', OLD."versionNumber", OLD."status" USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    IF NEW."status" NOT IN ('DRAFT', 'SHARED') THEN
      RAISE EXCEPTION 'a draft proposal version can only be shared, not %', NEW."status" USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'proposal version content is immutable once shared (version %)', OLD."versionNumber" USING ERRCODE = 'restrict_violation';
  END IF;

  IF NOT (
    OLD."status" = NEW."status"
    OR (OLD."status" = 'SHARED' AND NEW."status" IN ('SUPERSEDED', 'ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED'))
    OR (OLD."status" = 'CHANGES_REQUESTED' AND NEW."status" = 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'illegal proposal version transition % -> %', OLD."status", NEW."status" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER proposal_versions_guard_trg BEFORE UPDATE OR DELETE ON "proposal_versions"
  FOR EACH ROW EXECUTE FUNCTION proposal_versions_guard();

-- Children of a proposal version may only change while that version is a DRAFT.
CREATE OR REPLACE FUNCTION proposal_children_guard() RETURNS trigger AS $$
DECLARE vid uuid; vstatus text;
BEGIN
  IF TG_OP = 'DELETE' THEN vid := OLD."versionId"; ELSE vid := NEW."versionId"; END IF;
  SELECT "status"::text INTO vstatus FROM "proposal_versions" WHERE "id" = vid;
  IF vstatus IS NOT NULL AND vstatus <> 'DRAFT' THEN
    RAISE EXCEPTION '% on % rejected: proposal version is % (immutable)', TG_OP, TG_TABLE_NAME, vstatus USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER proposal_sections_guard BEFORE INSERT OR UPDATE OR DELETE ON "proposal_sections" FOR EACH ROW EXECUTE FUNCTION proposal_children_guard();
CREATE TRIGGER proposal_line_items_guard BEFORE INSERT OR UPDATE OR DELETE ON "proposal_line_items" FOR EACH ROW EXECUTE FUNCTION proposal_children_guard();
CREATE TRIGGER proposal_payment_terms_guard BEFORE INSERT OR UPDATE OR DELETE ON "proposal_payment_terms" FOR EACH ROW EXECUTE FUNCTION proposal_children_guard();

-- Decisions and signature events are records of fact.
CREATE OR REPLACE FUNCTION append_only_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER proposal_decisions_append_only BEFORE UPDATE OR DELETE ON "proposal_decisions" FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER signature_events_append_only BEFORE UPDATE OR DELETE ON "signature_events" FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- Agreement versions: DRAFT -> SENT -> SIGNED | DECLINED | VOID. Once sent, only status/signedAt may change.
CREATE OR REPLACE FUNCTION agreement_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'agreement version % is % and cannot be deleted', OLD."versionNumber", OLD."status" USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    IF NEW."status" NOT IN ('DRAFT', 'SENT', 'VOID') THEN
      RAISE EXCEPTION 'a draft agreement version can only be sent or voided, not %', NEW."status" USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'signedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'signedAt') THEN
    RAISE EXCEPTION 'agreement version content is immutable once sent (version %)', OLD."versionNumber" USING ERRCODE = 'restrict_violation';
  END IF;

  IF NOT (
    OLD."status" = NEW."status"
    OR (OLD."status" = 'SENT' AND NEW."status" IN ('SIGNED', 'DECLINED', 'VOID'))
  ) THEN
    RAISE EXCEPTION 'illegal agreement version transition % -> %', OLD."status", NEW."status" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agreement_versions_guard_trg BEFORE UPDATE OR DELETE ON "agreement_versions"
  FOR EACH ROW EXECUTE FUNCTION agreement_versions_guard();

CREATE OR REPLACE FUNCTION agreement_clauses_guard() RETURNS trigger AS $$
DECLARE vid uuid; vstatus text;
BEGIN
  IF TG_OP = 'DELETE' THEN vid := OLD."versionId"; ELSE vid := NEW."versionId"; END IF;
  SELECT "status"::text INTO vstatus FROM "agreement_versions" WHERE "id" = vid;
  IF vstatus IS NOT NULL AND vstatus <> 'DRAFT' THEN
    RAISE EXCEPTION '% on agreement_clauses rejected: agreement version is % (immutable; use an amendment)', TG_OP, vstatus USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agreement_clauses_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON "agreement_clauses"
  FOR EACH ROW EXECUTE FUNCTION agreement_clauses_guard();

-- Signers: structure is frozen at send; afterwards only the signing outcome columns may change.
CREATE OR REPLACE FUNCTION agreement_signers_guard() RETURNS trigger AS $$
DECLARE vid uuid; vstatus text;
BEGIN
  IF TG_OP = 'DELETE' THEN vid := OLD."versionId"; ELSE vid := NEW."versionId"; END IF;
  SELECT "status"::text INTO vstatus FROM "agreement_versions" WHERE "id" = vid;
  IF vstatus IS NULL OR vstatus = 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND vstatus = 'SENT'
     AND (to_jsonb(NEW) - 'status' - 'signedAt' - 'declinedAt' - 'declineReason')
         IS NOT DISTINCT FROM (to_jsonb(OLD) - 'status' - 'signedAt' - 'declinedAt' - 'declineReason')
     AND OLD."status" = 'PENDING' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% on agreement_signers rejected: agreement version is %', TG_OP, vstatus USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agreement_signers_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON "agreement_signers"
  FOR EACH ROW EXECUTE FUNCTION agreement_signers_guard();

-- Sanity constraints
ALTER TABLE "proposal_line_items" ADD CONSTRAINT "proposal_line_items_rates" CHECK ("unitRateMinor" >= 0 AND "quantity" >= 0 AND "discountBps" BETWEEN 0 AND 10000 AND "taxBps" BETWEEN 0 AND 10000);
ALTER TABLE "proposal_payment_terms" ADD CONSTRAINT "proposal_payment_terms_shape" CHECK ("percentageBps" IS NULL OR "percentageBps" BETWEEN 0 AND 10000);
ALTER TABLE "agreement_signers" ADD CONSTRAINT "agreement_signers_order" CHECK ("signingOrder" >= 1);

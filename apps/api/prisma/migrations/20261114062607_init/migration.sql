-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'PROJECT_MANAGER', 'FINANCE_MANAGER', 'COLLABORATOR');

-- CreateEnum
CREATE TYPE "NumberingScope" AS ENUM ('WORKSPACE', 'FINANCIAL_YEAR');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('COMPANY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AddressKind" AS ENUM ('BILLING', 'SERVICE');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING');

-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('OPEN', 'WON', 'LOST', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "RequirementKind" AS ENUM ('REQUIREMENT', 'DISCOVERY_NOTE');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'CLIENT_CONTACT', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "disabledAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" CHAR(2),
    "taxIdentifier" TEXT,
    "defaultCurrency" CHAR(3) NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_memberships" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_settings" (
    "workspaceId" UUID NOT NULL,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "invoiceNumbering" "NumberingScope" NOT NULL DEFAULT 'FINANCIAL_YEAR',
    "invoicePadding" INTEGER NOT NULL DEFAULT 4,
    "defaultPaymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "defaultTaxBps" INTEGER NOT NULL DEFAULT 1800,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspace_settings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "exponent" INTEGER NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "baseCurrency" CHAR(3) NOT NULL,
    "quoteCurrency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "asOf" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "type" "ClientType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "taxIdentifier" TEXT,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archivedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_contacts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "jobTitle" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "archivedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_addresses" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "kind" "AddressKind" NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" CHAR(2) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_interactions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "type" "InteractionType" NOT NULL,
    "summary" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StageKind" NOT NULL DEFAULT 'OPEN',
    "position" INTEGER NOT NULL,
    "probabilityBps" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagements" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "serviceCategory" TEXT,
    "source" TEXT,
    "estimatedValueMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "expectedStartDate" DATE,
    "expectedCloseDate" DATE,
    "lostReason" TEXT,
    "followUpAt" DATE,
    "archivedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_requirements" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "engagementId" UUID NOT NULL,
    "kind" "RequirementKind" NOT NULL DEFAULT 'REQUIREMENT',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_stage_history" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "engagementId" UUID NOT NULL,
    "fromStageId" UUID,
    "toStageId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "actorType" "AuditActorType" NOT NULL DEFAULT 'USER',
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "objectVersion" INTEGER,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "workspace_memberships_userId_idx" ON "workspace_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_memberships_workspaceId_userId_key" ON "workspace_memberships"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshTokenHash_key" ON "user_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "user_sessions_userId_revokedAt_idx" ON "user_sessions"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_workspaceId_key_scope_key" ON "number_sequences"("workspaceId", "key", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_baseCurrency_quoteCurrency_asOf_source_key" ON "exchange_rates"("baseCurrency", "quoteCurrency", "asOf", "source");

-- CreateIndex
CREATE INDEX "clients_workspaceId_status_idx" ON "clients"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "clients_workspaceId_name_idx" ON "clients"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "client_contacts_workspaceId_clientId_idx" ON "client_contacts"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "client_contacts_workspaceId_email_idx" ON "client_contacts"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "client_addresses_workspaceId_clientId_idx" ON "client_addresses"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "client_interactions_workspaceId_clientId_occurredAt_idx" ON "client_interactions"("workspaceId", "clientId", "occurredAt");

-- CreateIndex
CREATE INDEX "pipeline_stages_workspaceId_position_idx" ON "pipeline_stages"("workspaceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_workspaceId_name_key" ON "pipeline_stages"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "engagements_workspaceId_stageId_idx" ON "engagements"("workspaceId", "stageId");

-- CreateIndex
CREATE INDEX "engagements_workspaceId_clientId_idx" ON "engagements"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "engagement_requirements_workspaceId_engagementId_idx" ON "engagement_requirements"("workspaceId", "engagementId");

-- CreateIndex
CREATE INDEX "engagement_stage_history_workspaceId_engagementId_createdAt_idx" ON "engagement_stage_history"("workspaceId", "engagementId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_workspaceId_createdAt_idx" ON "audit_events"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_events_workspaceId_targetType_targetId_idx" ON "audit_events"("workspaceId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_addresses" ADD CONSTRAINT "client_addresses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_interactions" ADD CONSTRAINT "client_interactions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_requirements" ADD CONSTRAINT "engagement_requirements_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_stage_history" ADD CONSTRAINT "engagement_stage_history_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Hand-written guarantees (not expressible in Prisma) ─────────────

-- PRD §7.14: audit history is append-only for ordinary application users.
CREATE OR REPLACE FUNCTION audit_events_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_block_mutation();

-- PRD §7.3: one designated primary contact per client (ignoring archived contacts).
CREATE UNIQUE INDEX "client_contacts_one_primary_per_client"
  ON "client_contacts" ("clientId")
  WHERE "isPrimary" AND "archivedAt" IS NULL;

-- Stage history is likewise a record of fact; never rewritten.
CREATE OR REPLACE FUNCTION engagement_stage_history_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'engagement_stage_history is append-only' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER engagement_stage_history_no_update_delete
  BEFORE UPDATE OR DELETE ON "engagement_stage_history"
  FOR EACH ROW EXECUTE FUNCTION engagement_stage_history_block_mutation();

-- Sanity constraints
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_tax_bps_range" CHECK ("defaultTaxBps" BETWEEN 0 AND 10000);
ALTER TABLE "pipeline_stages"    ADD CONSTRAINT "pipeline_stages_probability_range" CHECK ("probabilityBps" BETWEEN 0 AND 10000);
ALTER TABLE "engagements"        ADD CONSTRAINT "engagements_value_non_negative" CHECK ("estimatedValueMinor" >= 0);
ALTER TABLE "currencies"         ADD CONSTRAINT "currencies_exponent_range" CHECK ("exponent" BETWEEN 0 AND 4);

-- Reference data
INSERT INTO "currencies" ("code", "name", "exponent") VALUES
  ('INR', 'Indian Rupee', 2),
  ('USD', 'US Dollar', 2),
  ('EUR', 'Euro', 2),
  ('GBP', 'Pound Sterling', 2),
  ('AED', 'UAE Dirham', 2),
  ('AUD', 'Australian Dollar', 2),
  ('CAD', 'Canadian Dollar', 2),
  ('SGD', 'Singapore Dollar', 2),
  ('JPY', 'Japanese Yen', 0),
  ('KWD', 'Kuwaiti Dinar', 3);

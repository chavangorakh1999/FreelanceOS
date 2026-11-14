-- CreateEnum
CREATE TYPE "PortalRole" AS ENUM ('VIEWER', 'APPROVER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('INVITATION', 'PROPOSAL_SHARED', 'PROPOSAL_DECIDED', 'AGREEMENT_SENT', 'AGREEMENT_SIGNED', 'SCOPE_REVIEW', 'SCOPE_DECIDED', 'CHANGE_UPDATE', 'INVOICE_SHARED', 'INVOICE_REMINDER', 'COMMENT');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DEAD');

-- AlterEnum
ALTER TYPE "SignatureMethod" ADD VALUE 'PORTAL';

-- AlterTable
ALTER TABLE "change_request_decisions" ADD COLUMN     "decidedByPortalUserId" UUID,
ALTER COLUMN "recordedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "change_requests" ADD COLUMN     "sharedAt" TIMESTAMPTZ,
ADD COLUMN     "visibility" "Visibility" NOT NULL DEFAULT 'INTERNAL';

-- AlterTable
ALTER TABLE "proposal_decisions" ADD COLUMN     "decidedByPortalUserId" UUID,
ALTER COLUMN "recordedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "scope_approvals" ADD COLUMN     "decidedByPortalUserId" UUID,
ALTER COLUMN "recordedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "signature_events" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "portalUserId" UUID,
ADD COLUMN     "userAgent" TEXT;

-- CreateTable
CREATE TABLE "portal_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "disabledAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "portal_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_memberships" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "portalUserId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "role" "PortalRole" NOT NULL DEFAULT 'VIEWER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_invitations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "PortalRole" NOT NULL DEFAULT 'VIEWER',
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "usedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "invitedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_project_grants" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "grantedById" UUID NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_project_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" UUID NOT NULL,
    "portalUserId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID,
    "portalUserId" UUID,
    "category" "NotificationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkPath" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "toEmail" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID,
    "portalUserId" UUID,
    "category" "NotificationCategory" NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "proposalId" UUID,
    "projectId" UUID,
    "changeRequestId" UUID,
    "visibility" "Visibility" NOT NULL DEFAULT 'INTERNAL',
    "body" TEXT NOT NULL,
    "authorUserId" UUID,
    "authorPortalUserId" UUID,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_users_email_key" ON "portal_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "portal_memberships_contactId_key" ON "portal_memberships"("contactId");

-- CreateIndex
CREATE INDEX "portal_memberships_workspaceId_clientId_idx" ON "portal_memberships"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "portal_memberships_portalUserId_idx" ON "portal_memberships"("portalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_invitations_tokenHash_key" ON "portal_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "portal_invitations_workspaceId_contactId_idx" ON "portal_invitations"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "portal_project_grants_projectId_idx" ON "portal_project_grants"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_project_grants_contactId_projectId_key" ON "portal_project_grants"("contactId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_refreshTokenHash_key" ON "portal_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "portal_sessions_portalUserId_revokedAt_idx" ON "portal_sessions"("portalUserId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_portalUserId_readAt_createdAt_idx" ON "notifications"("portalUserId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_nextAttemptAt_idx" ON "notification_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_workspaceId_status_idx" ON "notification_deliveries"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_category_key" ON "notification_preferences"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_portalUserId_category_key" ON "notification_preferences"("portalUserId", "category");

-- CreateIndex
CREATE INDEX "comments_proposalId_createdAt_idx" ON "comments"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "comments_projectId_createdAt_idx" ON "comments"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "comments_changeRequestId_createdAt_idx" ON "comments"("changeRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "client_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "client_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_project_grants" ADD CONSTRAINT "portal_project_grants_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "client_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_project_grants" ADD CONSTRAINT "portal_project_grants_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "portal_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorPortalUserId_fkey" FOREIGN KEY ("authorPortalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Portal isolation and communications integrity (PRD §4.2, §7.12, §7.13) ─────────────

-- A decision is made either by staff (recording on the client's behalf) or by the client themselves — never neither, never both.
ALTER TABLE "proposal_decisions"       ADD CONSTRAINT "proposal_decisions_actor"       CHECK (("recordedById" IS NOT NULL) <> ("decidedByPortalUserId" IS NOT NULL));
ALTER TABLE "scope_approvals"          ADD CONSTRAINT "scope_approvals_actor"          CHECK (("recordedById" IS NOT NULL) <> ("decidedByPortalUserId" IS NOT NULL));
ALTER TABLE "change_request_decisions" ADD CONSTRAINT "change_request_decisions_actor" CHECK (("recordedById" IS NOT NULL) <> ("decidedByPortalUserId" IS NOT NULL));
ALTER TABLE "proposal_decisions"       ADD CONSTRAINT "proposal_decisions_portal_fk"       FOREIGN KEY ("decidedByPortalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT;
ALTER TABLE "scope_approvals"          ADD CONSTRAINT "scope_approvals_portal_fk"          FOREIGN KEY ("decidedByPortalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT;
ALTER TABLE "change_request_decisions" ADD CONSTRAINT "change_request_decisions_portal_fk" FOREIGN KEY ("decidedByPortalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT;
ALTER TABLE "signature_events"         ADD CONSTRAINT "signature_events_portal_fk"         FOREIGN KEY ("portalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT;

-- Exactly one recipient / owner / target / author.
ALTER TABLE "notifications"            ADD CONSTRAINT "notifications_one_recipient" CHECK (("userId" IS NOT NULL) <> ("portalUserId" IS NOT NULL));
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_prefs_one_owner" CHECK (("userId" IS NOT NULL) <> ("portalUserId" IS NOT NULL));
ALTER TABLE "comments" ADD CONSTRAINT "comments_one_target" CHECK (num_nonnulls("proposalId", "projectId", "changeRequestId") = 1);
ALTER TABLE "comments" ADD CONSTRAINT "comments_one_author" CHECK (("authorUserId" IS NOT NULL) <> ("authorPortalUserId" IS NOT NULL));
ALTER TABLE "comments" ADD CONSTRAINT "comments_visibility" CHECK ("visibility" IN ('INTERNAL', 'CLIENT_VISIBLE'));
-- A client can only ever write client-visible comments.
ALTER TABLE "comments" ADD CONSTRAINT "comments_portal_authors_are_visible" CHECK ("authorPortalUserId" IS NULL OR "visibility" = 'CLIENT_VISIBLE');
CREATE TRIGGER comments_append_only BEFORE UPDATE OR DELETE ON "comments" FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- Tenant safety nets: a portal membership, invitation or project grant can never reach across clients or workspaces,
-- even if application code is wrong.
CREATE OR REPLACE FUNCTION portal_membership_scope_guard() RETURNS trigger AS $$
DECLARE c "client_contacts"%ROWTYPE;
BEGIN
  SELECT * INTO c FROM "client_contacts" WHERE "id" = NEW."contactId";
  IF c."clientId" <> NEW."clientId" OR c."workspaceId" <> NEW."workspaceId" THEN
    RAISE EXCEPTION 'the contact does not belong to that client' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER portal_memberships_scope BEFORE INSERT OR UPDATE ON "portal_memberships" FOR EACH ROW EXECUTE FUNCTION portal_membership_scope_guard();
CREATE TRIGGER portal_invitations_scope BEFORE INSERT ON "portal_invitations" FOR EACH ROW EXECUTE FUNCTION portal_membership_scope_guard();

CREATE OR REPLACE FUNCTION portal_grant_scope_guard() RETURNS trigger AS $$
DECLARE c "client_contacts"%ROWTYPE; p "projects"%ROWTYPE;
BEGIN
  SELECT * INTO c FROM "client_contacts" WHERE "id" = NEW."contactId";
  SELECT * INTO p FROM "projects" WHERE "id" = NEW."projectId";
  IF p."clientId" <> c."clientId" OR p."workspaceId" <> NEW."workspaceId" OR c."workspaceId" <> NEW."workspaceId" THEN
    RAISE EXCEPTION 'a contact can only be granted access to projects of their own client' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER portal_project_grants_scope BEFORE INSERT ON "portal_project_grants" FOR EACH ROW EXECUTE FUNCTION portal_grant_scope_guard();

-- A comment's target must be in the comment's workspace.
CREATE OR REPLACE FUNCTION comments_scope_guard() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  IF NEW."proposalId" IS NOT NULL THEN SELECT "workspaceId" INTO ws FROM "proposals" WHERE "id" = NEW."proposalId";
  ELSIF NEW."projectId" IS NOT NULL THEN SELECT "workspaceId" INTO ws FROM "projects" WHERE "id" = NEW."projectId";
  ELSE SELECT "workspaceId" INTO ws FROM "change_requests" WHERE "id" = NEW."changeRequestId"; END IF;
  IF ws IS DISTINCT FROM NEW."workspaceId" THEN
    RAISE EXCEPTION 'a comment must be in the same workspace as the record it is about' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER comments_scope BEFORE INSERT ON "comments" FOR EACH ROW EXECUTE FUNCTION comments_scope_guard();

ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_attempts" CHECK ("attempts" >= 0);

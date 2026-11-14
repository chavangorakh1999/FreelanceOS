-- Recreate the portal-actor foreign keys exactly as Prisma declares them, so the schema and database never drift.
ALTER TABLE "proposal_decisions"       DROP CONSTRAINT "proposal_decisions_portal_fk";
ALTER TABLE "scope_approvals"          DROP CONSTRAINT "scope_approvals_portal_fk";
ALTER TABLE "change_request_decisions" DROP CONSTRAINT "change_request_decisions_portal_fk";
ALTER TABLE "signature_events"         DROP CONSTRAINT "signature_events_portal_fk";
ALTER TABLE "proposal_decisions"       ADD CONSTRAINT "proposal_decisions_decidedByPortalUserId_fkey"       FOREIGN KEY ("decidedByPortalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scope_approvals"          ADD CONSTRAINT "scope_approvals_decidedByPortalUserId_fkey"          FOREIGN KEY ("decidedByPortalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "change_request_decisions" ADD CONSTRAINT "change_request_decisions_decidedByPortalUserId_fkey" FOREIGN KEY ("decidedByPortalUserId") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "signature_events"         ADD CONSTRAINT "signature_events_portalUserId_fkey"                  FOREIGN KEY ("portalUserId")          REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

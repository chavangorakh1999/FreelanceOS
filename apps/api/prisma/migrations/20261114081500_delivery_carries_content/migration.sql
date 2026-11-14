-- Outbox rows carry their own message content, so an email can exist without an in-app notification
-- (e.g. an invitation to someone who has no portal account yet).
ALTER TABLE "notification_deliveries" ALTER COLUMN "notificationId" DROP NOT NULL;
ALTER TABLE "notification_deliveries" ADD COLUMN "category" "NotificationCategory" NOT NULL DEFAULT 'COMMENT';
ALTER TABLE "notification_deliveries" ADD COLUMN "subject" TEXT NOT NULL DEFAULT '';
ALTER TABLE "notification_deliveries" ADD COLUMN "bodyText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "notification_deliveries" ADD COLUMN "linkPath" TEXT NOT NULL DEFAULT '/';
ALTER TABLE "notification_deliveries" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "notification_deliveries" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "notification_deliveries" ALTER COLUMN "subject" DROP DEFAULT;
ALTER TABLE "notification_deliveries" ALTER COLUMN "bodyText" DROP DEFAULT;
ALTER TABLE "notification_deliveries" ALTER COLUMN "linkPath" DROP DEFAULT;
CREATE UNIQUE INDEX "notification_deliveries_dedupeKey_key" ON "notification_deliveries"("dedupeKey");

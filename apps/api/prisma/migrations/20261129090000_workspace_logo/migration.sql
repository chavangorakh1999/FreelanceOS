-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "logoMimeType" TEXT,
ADD COLUMN     "logoStorageKey" TEXT,
ADD COLUMN     "logoUpdatedAt" TIMESTAMPTZ;

ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_logo_complete" CHECK (("logoStorageKey" IS NULL) = ("logoMimeType" IS NULL));

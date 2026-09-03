-- AlterTable
ALTER TABLE "outreach" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "canvass_requested_at" TIMESTAMP(3),
ADD COLUMN     "denied_at" TIMESTAMP(3),
ADD COLUMN     "denied_by" TEXT,
ADD COLUMN     "denied_reason" TEXT;

-- AlterTable
ALTER TABLE "outreach_email" ADD COLUMN     "audience_cursor" TEXT,
ADD COLUMN     "audience_resolved_at" TIMESTAMP(3);

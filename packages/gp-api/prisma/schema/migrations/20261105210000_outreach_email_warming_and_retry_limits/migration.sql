-- AlterTable
ALTER TABLE "outreach_email_recipient" ADD COLUMN     "retry_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "outreach_email_sender" ADD COLUMN     "warming_advanced_at" TIMESTAMP(3);

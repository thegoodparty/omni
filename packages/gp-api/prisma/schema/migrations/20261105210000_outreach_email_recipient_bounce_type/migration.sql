-- AlterTable
ALTER TABLE "outreach_email_recipient" ADD COLUMN     "bounce_type" TEXT;

-- CreateIndex
CREATE INDEX "outreach_email_recipient_email_idx" ON "outreach_email_recipient"("email");

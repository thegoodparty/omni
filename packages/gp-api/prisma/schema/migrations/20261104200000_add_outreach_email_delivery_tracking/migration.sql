-- AlterEnum
ALTER TYPE "OutreachEmailRecipientStatus" ADD VALUE 'delivered';

-- AlterTable
ALTER TABLE "outreach_email_recipient" ADD COLUMN     "bounced_at" TIMESTAMP(3),
ADD COLUMN     "complained_at" TIMESTAMP(3),
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "first_clicked_at" TIMESTAMP(3),
ADD COLUMN     "first_opened_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "outreach_email_event_file" (
    "key" TEXT NOT NULL,
    "event_count" INTEGER NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_email_event_file_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "outreach_email_event_file_processed_at_idx" ON "outreach_email_event_file"("processed_at");


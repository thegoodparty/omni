-- CreateEnum
CREATE TYPE "OutreachHandoffHandler" AS ENUM ('agent', 'manual');

-- CreateEnum
CREATE TYPE "OutreachHandoffStatus" AS ENUM ('queued', 'built', 'scheduled', 'replies_submitted', 'needs_human');

-- CreateTable
CREATE TABLE "outreach_text_handoff" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "handler" "OutreachHandoffHandler" NOT NULL,
    "status" "OutreachHandoffStatus" NOT NULL DEFAULT 'queued',
    "mode" TEXT NOT NULL,
    "send_at" TIMESTAMP(3) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "claim_token" TEXT,
    "vendor_campaign_name" TEXT,
    "sending_number" TEXT,
    "audience_count" INTEGER,
    "scheduled_at" TIMESTAMP(3),
    "replies_due_at" TIMESTAMP(3),
    "replies_submitted_at" TIMESTAMP(3),
    "needs_human_at" TIMESTAMP(3),
    "needs_human_reason" TEXT,

    CONSTRAINT "outreach_text_handoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_text_handoff_outreach_id_key" ON "outreach_text_handoff"("outreach_id");

-- CreateIndex
CREATE INDEX "outreach_text_handoff_status_replies_due_at_idx" ON "outreach_text_handoff"("status", "replies_due_at");

-- AddForeignKey
ALTER TABLE "outreach_text_handoff" ADD CONSTRAINT "outreach_text_handoff_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

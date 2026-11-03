-- DropIndex
DROP INDEX "outreach_text_handoff_status_replies_due_at_idx";

-- AlterTable
ALTER TABLE "outreach_text_handoff" DROP COLUMN "claimed_at",
DROP COLUMN "claim_token",
DROP COLUMN "vendor_campaign_name",
DROP COLUMN "sending_number",
DROP COLUMN "audience_count",
DROP COLUMN "scheduled_at",
DROP COLUMN "replies_due_at";

-- Rows the deleted agent routes moved on are still waiting for replies.
UPDATE "outreach_text_handoff" SET "status" = 'queued' WHERE "status" IN ('built', 'scheduled', 'needs_human');

-- AlterEnum
BEGIN;
CREATE TYPE "OutreachHandoffStatus_new" AS ENUM ('queued', 'replies_submitted');
ALTER TABLE "outreach_text_handoff" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "outreach_text_handoff" ALTER COLUMN "status" TYPE "OutreachHandoffStatus_new" USING ("status"::text::"OutreachHandoffStatus_new");
ALTER TYPE "OutreachHandoffStatus" RENAME TO "OutreachHandoffStatus_old";
ALTER TYPE "OutreachHandoffStatus_new" RENAME TO "OutreachHandoffStatus";
DROP TYPE "OutreachHandoffStatus_old";
ALTER TABLE "outreach_text_handoff" ALTER COLUMN "status" SET DEFAULT 'queued';
COMMIT;

-- CreateIndex
CREATE INDEX "outreach_text_handoff_status_send_at_idx" ON "outreach_text_handoff"("status", "send_at");

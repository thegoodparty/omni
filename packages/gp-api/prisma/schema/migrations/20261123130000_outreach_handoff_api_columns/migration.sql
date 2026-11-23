-- CreateEnum
CREATE TYPE "OutreachHandoffApiStep" AS ENUM ('pending', 'created', 'loading', 'checked', 'starting', 'ready', 'sending', 'sent');

-- AlterEnum
ALTER TYPE "OutreachHandoffHandler" ADD VALUE 'api';

-- AlterTable
ALTER TABLE "outreach_text_handoff" ADD COLUMN     "api_campaign_id" TEXT,
ADD COLUMN     "api_step" "OutreachHandoffApiStep",
ADD COLUMN     "load_skips" JSONB,
ADD COLUMN     "loaded_count" INTEGER,
ADD COLUMN     "preview_sent_at" TIMESTAMP(3),
ADD COLUMN     "recipient_count" INTEGER,
ADD COLUMN     "recipient_csv_key" TEXT,
ADD COLUMN     "sending_phone_number" TEXT,
ADD COLUMN     "sent_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_text_handoff_api_campaign_id_key" ON "outreach_text_handoff"("api_campaign_id");

-- CreateIndex
CREATE INDEX "outreach_text_handoff_handler_api_step_idx" ON "outreach_text_handoff"("handler", "api_step");


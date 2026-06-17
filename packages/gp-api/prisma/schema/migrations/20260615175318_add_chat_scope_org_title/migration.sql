-- CreateEnum
CREATE TYPE "ChatScope" AS ENUM ('briefing_annotation', 'chief_of_staff', 'campaign_assistant');

-- AlterTable
ALTER TABLE "chat_conversation" ADD COLUMN     "organization_slug" TEXT,
ADD COLUMN     "scope" "ChatScope" NOT NULL DEFAULT 'briefing_annotation',
ADD COLUMN     "title" TEXT;

-- Backfill: every pre-existing conversation is a briefing annotation chat. The
-- column default already covers rows present during this ALTER, but we state
-- the data migration explicitly so the intent is reviewable and any row that
-- somehow differs is corrected.
UPDATE "chat_conversation" SET "scope" = 'briefing_annotation' WHERE "scope" <> 'briefing_annotation';

-- CreateIndex
CREATE INDEX "chat_conversation_owner_user_id_organization_slug_scope_del_idx" ON "chat_conversation"("owner_user_id", "organization_slug", "scope", "deleted_at");

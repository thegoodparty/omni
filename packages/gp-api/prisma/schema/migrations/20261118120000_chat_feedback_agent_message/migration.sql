-- Ratings move onto AgentMessage. The column is added beside the ChatMessage
-- one rather than replacing it: this migration ships while the previous
-- deploy's tasks are still serving and still rating by chat_message_id, so
-- the old column has to stay readable and writable until that code is gone.
-- The drop is a separate migration.

-- AlterTable
ALTER TABLE "chat_message_feedback" ADD COLUMN "agent_message_id" TEXT,
  ALTER COLUMN "chat_message_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_feedback_user_agent_message_unique"
  ON "chat_message_feedback"("submitter_user_id", "agent_message_id");

-- AddForeignKey
ALTER TABLE "chat_message_feedback" ADD CONSTRAINT "chat_message_feedback_agent_message_id_fkey"
  FOREIGN KEY ("agent_message_id") REFERENCES "agent_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: a turn's last Assistant AgentMessage row reuses its ChatMessage id,
-- so existing ratings already name the row that should carry them. Ratings on
-- a message with no AgentMessage counterpart stay null and are re-pointed by
-- the backfill that runs before the drop.
UPDATE "chat_message_feedback" f
SET "agent_message_id" = f."chat_message_id"
WHERE EXISTS (
  SELECT 1 FROM "agent_message" m WHERE m."id" = f."chat_message_id"
);

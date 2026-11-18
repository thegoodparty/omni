-- Chat writes and reads only `agent_message` since #3872, and since #3891 no
-- task reads `chat_message` or `chat_message_segment` either. That second part
-- is what this deploy depends on: Prisma names every mapped scalar column in
-- its SELECTs, so the deploy before #3891 would have read
-- chat_message_feedback.chat_message_id on every feedback query, and dropping
-- the column under those tasks would have failed chat transcript loads and
-- ratings for the length of a rollout.

-- A rating should name an AgentMessage, but the column stays nullable for one
-- more deploy: #3872's backfill left a rating null wherever the message it
-- rated had no AgentMessage counterpart, and a startup migration that refused
-- over one such row would fail the container's boot and leave a record in
-- _prisma_migrations that every later `migrate deploy` blocks on. The count is
-- reported instead, and NOT NULL follows in its own migration once prod is
-- known to have none. Nothing is deleted: those rows keep their conversation
-- and comment, and read as unkeyed until they are re-pointed. The unique index
-- on (submitter_user_id, agent_message_id) that #3872's migration already
-- created tolerates them, as Postgres treats NULLs as distinct.
DO $$
DECLARE
    unkeyed bigint;
BEGIN
    SELECT count(*) INTO unkeyed
    FROM "chat_message_feedback"
    WHERE "agent_message_id" IS NULL;

    RAISE NOTICE
        'chat_message_feedback: % row(s) have no agent_message_id and stay unkeyed; agent_message_id is left nullable this deploy',
        unkeyed;
END $$;

-- DropForeignKey
ALTER TABLE "chat_message_feedback" DROP CONSTRAINT "chat_message_feedback_chat_message_id_fkey";

-- DropIndex
DROP INDEX "chat_message_feedback_user_message_unique";

-- AlterTable
ALTER TABLE "chat_message_feedback" DROP COLUMN "chat_message_id";

-- DropTable
DROP TABLE "chat_message_segment";

-- DropTable
DROP TABLE "chat_message";

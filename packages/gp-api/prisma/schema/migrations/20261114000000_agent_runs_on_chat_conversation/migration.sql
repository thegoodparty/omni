-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'superseded');

-- AlterEnum
ALTER TYPE "ChatScope" ADD VALUE 'background_agent';

-- AlterTable
ALTER TABLE "chat_conversation" ADD COLUMN     "agent_name" TEXT,
ADD COLUMN     "judge_replay" JSONB,
ADD COLUMN     "parent_run_id" TEXT,
ADD COLUMN     "run_error" TEXT,
ADD COLUMN     "run_input" JSONB,
ADD COLUMN     "run_output" JSONB,
ADD COLUMN     "shape_hash" TEXT,
ADD COLUMN     "shape_stamped_at" TIMESTAMP(3),
ADD COLUMN     "status" "AgentRunStatus",
ALTER COLUMN "owner_user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "chat_message" ADD COLUMN     "step" JSONB;

-- CreateIndex
CREATE INDEX "chat_conversation_parent_run_id_idx" ON "chat_conversation"("parent_run_id");

-- AddForeignKey
ALTER TABLE "chat_conversation" ADD CONSTRAINT "chat_conversation_parent_run_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "chat_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'superseded');

-- AlterEnum
ALTER TYPE "ChatScope" ADD VALUE 'background_agent';

-- AlterTable
ALTER TABLE "chat_conversation" ADD COLUMN     "agent_name" TEXT,
ADD COLUMN     "judge_replay" JSONB,
ADD COLUMN     "run_error" TEXT,
ADD COLUMN     "run_input" JSONB,
ADD COLUMN     "run_output" JSONB,
ADD COLUMN     "shape_hash" TEXT,
ADD COLUMN     "shape_stamped_at" TIMESTAMP(3),
ADD COLUMN     "status" "AgentRunStatus",
ADD COLUMN     "superseded_by_run_id" TEXT,
ALTER COLUMN "owner_user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "chat_message" ADD COLUMN     "step" JSONB;

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'superseded');

-- AlterEnum
ALTER TYPE "ChatScope" ADD VALUE 'background_agent';

-- AlterTable
ALTER TABLE "chat_conversation" ADD COLUMN     "agent" TEXT,
ADD COLUMN     "agent_input" JSONB,
ADD COLUMN     "cost_usd" DOUBLE PRECISION,
ADD COLUMN     "judge_replay" JSONB,
ADD COLUMN     "parent_run_id" TEXT,
ADD COLUMN     "run_error" TEXT,
ADD COLUMN     "run_status" "AgentRunStatus",
ADD COLUMN     "shape_hash" TEXT,
ADD COLUMN     "stage_summary" JSONB,
ALTER COLUMN "owner_user_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversation_parent_run_id_key" ON "chat_conversation"("parent_run_id");

-- CreateIndex
CREATE INDEX "chat_conversation_agent_shape_hash_idx" ON "chat_conversation"("agent", "shape_hash");

-- LangGraph's checkpoint tables (@langchain/langgraph-checkpoint-postgres
-- 1.1.x, its migrations 0 to 5), owned here so tasks never race to create
-- them. PostgresSaver.setup() reads checkpoint_migrations and finds nothing
-- to do. Prisma only diffs the public schema, so it ignores these.
CREATE SCHEMA IF NOT EXISTS "langgraph";

CREATE TABLE IF NOT EXISTS "langgraph"."checkpoint_migrations" (
    v INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS "langgraph"."checkpoints" (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type TEXT,
    checkpoint JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS "langgraph"."checkpoint_blobs" (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT NOT NULL,
    blob BYTEA,
    PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE IF NOT EXISTS "langgraph"."checkpoint_writes" (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT,
    blob BYTEA NOT NULL,
    task_path TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

INSERT INTO "langgraph"."checkpoint_migrations" (v)
VALUES (0), (1), (2), (3), (4), (5)
ON CONFLICT DO NOTHING;

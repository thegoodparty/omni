-- CreateEnum
CREATE TYPE "AgentMessageRole" AS ENUM ('user', 'assistant', 'tool');

-- CreateTable
CREATE TABLE "agent_message" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "agent_run_id" TEXT,
    "index" INTEGER NOT NULL,
    "role" "AgentMessageRole" NOT NULL,
    "parts" JSONB NOT NULL,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cache_read_tokens" INTEGER,
    "cache_write_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_message_conversation_id_index_key" ON "agent_message"("conversation_id", "index");

-- CreateIndex
CREATE UNIQUE INDEX "agent_message_agent_run_id_index_key" ON "agent_message"("agent_run_id", "index");

-- AddForeignKey
ALTER TABLE "agent_message" ADD CONSTRAINT "agent_message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A row belongs to exactly one parent, so a message can be neither orphaned nor
-- in two places. Not modeled in Prisma: the schema cannot express a CHECK.
ALTER TABLE "agent_message" ADD CONSTRAINT "agent_message_one_parent"
  CHECK (num_nonnulls("conversation_id", "agent_run_id") = 1);

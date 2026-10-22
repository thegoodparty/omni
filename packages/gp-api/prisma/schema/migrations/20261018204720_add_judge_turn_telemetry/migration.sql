-- CreateTable
CREATE TABLE "judge_turn_telemetry" (
    "id" TEXT NOT NULL,
    "sweep_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "turn_index" INTEGER NOT NULL,
    "assistant_message_id" TEXT,
    "prompt_hash" TEXT NOT NULL,
    "prompt_hash_version" TEXT NOT NULL,
    "tool_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tool_steps" JSONB NOT NULL,
    "tool_queries" JSONB NOT NULL,
    "data_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "judge_turn_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "judge_turn_telemetry_sweep_id_idx" ON "judge_turn_telemetry"("sweep_id");

-- CreateIndex
CREATE UNIQUE INDEX "judge_turn_telemetry_conversation_id_turn_index_key" ON "judge_turn_telemetry"("conversation_id", "turn_index");

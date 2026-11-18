-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'superseded');

-- CreateTable
CREATE TABLE "agent_run" (
    "id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL,
    "manifest" JSONB NOT NULL,
    "shape_hash" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "artifact" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_run_organization_slug_agent_name_status_idx" ON "agent_run"("organization_slug", "agent_name", "status");

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_message" ADD CONSTRAINT "agent_message_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "SynthesisScope" ADD VALUE IF NOT EXISTS 'priority';

-- AlterTable
ALTER TABLE "feedback_synthesis_run" ADD COLUMN "priority_id" TEXT;

-- CreateIndex
CREATE INDEX "feedback_synthesis_run_organization_slug_priority_id_create_idx" ON "feedback_synthesis_run"("organization_slug", "priority_id", "created_at");

-- AddForeignKey
ALTER TABLE "feedback_synthesis_run" ADD CONSTRAINT "feedback_synthesis_run_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "priority"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "campaign_tracker_tasks" ADD COLUMN     "source_run_id" TEXT;

-- CreateIndex
CREATE INDEX "campaign_tracker_tasks_campaign_id_source_run_id_idx" ON "campaign_tracker_tasks"("campaign_id", "source_run_id");

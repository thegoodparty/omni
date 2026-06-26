-- CreateTable
CREATE TABLE "campaign_tracker_tasks" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cta" TEXT,
    "flow_type" "CampaignTaskType",
    "week" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "link" TEXT,
    "pro_required" BOOLEAN DEFAULT false,
    "is_default_task" BOOLEAN DEFAULT false,
    "deadline" INTEGER,
    "default_ai_template_id" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "phase" TEXT,
    "campaign_id" INTEGER NOT NULL,
    "update_history_id" INTEGER,

    CONSTRAINT "campaign_tracker_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_tracker_tasks_update_history_id_key" ON "campaign_tracker_tasks"("update_history_id");

-- CreateIndex
CREATE INDEX "campaign_tracker_tasks_campaign_id_idx" ON "campaign_tracker_tasks"("campaign_id");

-- CreateIndex
CREATE INDEX "campaign_tracker_tasks_campaign_id_completed_idx" ON "campaign_tracker_tasks"("campaign_id", "completed");

-- CreateIndex
CREATE INDEX "campaign_tracker_tasks_date_idx" ON "campaign_tracker_tasks"("date");

-- AddForeignKey
ALTER TABLE "campaign_tracker_tasks" ADD CONSTRAINT "campaign_tracker_tasks_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_tracker_tasks" ADD CONSTRAINT "campaign_tracker_tasks_update_history_id_fkey" FOREIGN KEY ("update_history_id") REFERENCES "campaign_update_history"("id") ON DELETE SET NULL ON UPDATE CASCADE;

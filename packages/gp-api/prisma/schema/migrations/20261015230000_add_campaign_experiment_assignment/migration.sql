-- CreateTable
CREATE TABLE "campaign_experiment_assignment" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "flag_key" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "owner_user_id" INTEGER NOT NULL,

    CONSTRAINT "campaign_experiment_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_experiment_assignment_flag_key_arm_idx" ON "campaign_experiment_assignment"("flag_key", "arm");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_experiment_assignment_campaign_id_flag_key_key" ON "campaign_experiment_assignment"("campaign_id", "flag_key");

-- AddForeignKey
ALTER TABLE "campaign_experiment_assignment" ADD CONSTRAINT "campaign_experiment_assignment_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "race_opponent_summary" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "opponent_name" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "run_id" TEXT,

    CONSTRAINT "race_opponent_summary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "race_opponent_summary_campaign_id_opponent_name_key" ON "race_opponent_summary"("campaign_id", "opponent_name");

-- AddForeignKey
ALTER TABLE "race_opponent_summary" ADD CONSTRAINT "race_opponent_summary_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;


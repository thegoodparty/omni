-- CreateTable
CREATE TABLE "race_opponent_field_analysis" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "sections" JSONB NOT NULL,
    "run_id" TEXT,

    CONSTRAINT "race_opponent_field_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "race_opponent_field_analysis_campaign_id_key" ON "race_opponent_field_analysis"("campaign_id");

-- AddForeignKey
ALTER TABLE "race_opponent_field_analysis" ADD CONSTRAINT "race_opponent_field_analysis_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

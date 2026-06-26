-- CreateEnum
CREATE TYPE "RaceOpponentSourceType" AS ENUM ('ballotpedia', 'opponent_website', 'campaign_plan_db');

-- CreateTable
CREATE TABLE "race_opponent" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaign_id" INTEGER NOT NULL,
    "opponent_name" TEXT NOT NULL,
    "source_type" "RaceOpponentSourceType" NOT NULL,
    "source_url" TEXT,
    "content" JSONB NOT NULL,
    "run_id" TEXT,

    CONSTRAINT "race_opponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "race_opponent_campaign_id_opponent_name_idx" ON "race_opponent"("campaign_id", "opponent_name");

-- AddForeignKey
ALTER TABLE "race_opponent" ADD CONSTRAINT "race_opponent_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;


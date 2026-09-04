-- CreateTable
CREATE TABLE "campaign_ideology" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "bucket" TEXT,
    "evidence" TEXT,
    "input_hash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_ideology_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_ideology_campaign_id_key" ON "campaign_ideology"("campaign_id");

-- AddForeignKey
ALTER TABLE "campaign_ideology" ADD CONSTRAINT "campaign_ideology_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

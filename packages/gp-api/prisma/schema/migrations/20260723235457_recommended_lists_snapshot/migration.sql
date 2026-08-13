-- CreateTable
CREATE TABLE "recommended_lists_snapshot" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "race_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "computed_at" TIMESTAMP(3),
    "payload" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommended_lists_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recommended_lists_snapshot_campaign_id_key" ON "recommended_lists_snapshot"("campaign_id");

-- AddForeignKey
ALTER TABLE "recommended_lists_snapshot" ADD CONSTRAINT "recommended_lists_snapshot_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

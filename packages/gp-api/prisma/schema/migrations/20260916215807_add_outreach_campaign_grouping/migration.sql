-- AlterTable
ALTER TABLE "outreach" ADD COLUMN     "campaign_outreach_id" INTEGER;

-- CreateIndex
CREATE INDEX "outreach_campaign_outreach_id_idx" ON "outreach"("campaign_outreach_id");

-- AddForeignKey
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_campaign_outreach_id_fkey" FOREIGN KEY ("campaign_outreach_id") REFERENCES "outreach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "voter_outreach_activity" ADD COLUMN     "source_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "voter_outreach_activity_campaign_id_outreach_type_source_id_key" ON "voter_outreach_activity"("campaign_id", "outreach_type", "source_id");

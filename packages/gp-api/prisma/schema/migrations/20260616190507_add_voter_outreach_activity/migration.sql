-- CreateEnum
CREATE TYPE "VoterOutreachAttributionSource" AS ENUM ('recipient', 'segmentDerived');

-- CreateTable
CREATE TABLE "voter_outreach_activity" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaign_id" INTEGER NOT NULL,
    "lal_voter_id" TEXT NOT NULL,
    "outreach_type" "OutreachType" NOT NULL,
    "attribution_source" "VoterOutreachAttributionSource" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "outreach_id" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "voter_outreach_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voter_outreach_activity_campaign_id_lal_voter_id_occurred_a_idx" ON "voter_outreach_activity"("campaign_id", "lal_voter_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "voter_outreach_activity" ADD CONSTRAINT "voter_outreach_activity_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter_outreach_activity" ADD CONSTRAINT "voter_outreach_activity_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

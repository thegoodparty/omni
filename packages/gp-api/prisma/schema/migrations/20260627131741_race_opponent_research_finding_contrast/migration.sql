-- CreateEnum
CREATE TYPE "RaceOpponentResearchStatus" AS ENUM ('not_started', 'queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "RaceOpponentContrastStatus" AS ENUM ('draft', 'pending_review', 'cleared', 'blocked', 'approved', 'used', 'discarded');

-- CreateEnum
CREATE TYPE "RaceOpponentFindingKind" AS ENUM ('self', 'opponent');

-- CreateTable
CREATE TABLE "race_opponent_research" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "kind" "RaceOpponentFindingKind" NOT NULL,
    "opponent_name" TEXT,
    "election_candidacy_id" TEXT,
    "status" "RaceOpponentResearchStatus" NOT NULL DEFAULT 'not_started',
    "run_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "last_viewed_at" TIMESTAMP(3),

    CONSTRAINT "race_opponent_research_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "race_opponent_finding" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "research_id" INTEGER NOT NULL,
    "claim" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_extract" TEXT NOT NULL,
    "source_title" TEXT,
    "source_reachable_at" TIMESTAMP(3),
    "category" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3),
    "drafted_response" TEXT,

    CONSTRAINT "race_opponent_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "race_opponent_contrast" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "finding_id" INTEGER,
    "opponent_fact" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "candidate_fact" TEXT NOT NULL,
    "contrast_sentence" TEXT NOT NULL,
    "issue_tag" TEXT NOT NULL,
    "routing" TEXT NOT NULL,
    "status" "RaceOpponentContrastStatus" NOT NULL DEFAULT 'draft',
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "routed_story_id" INTEGER,
    "routed_outreach_id" INTEGER,

    CONSTRAINT "race_opponent_contrast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- NULLS NOT DISTINCT is a manual deviation from `prisma migrate diff` output.
-- opponent_name is nullable (self-research has no opponent), and PostgreSQL's
-- default treats NULLs as distinct in unique indexes, which would let multiple
-- (campaign_id, 'self', NULL) rows through and break "one self-research per
-- campaign". Treating nulls as a single value enforces that grain.
CREATE UNIQUE INDEX "race_opponent_research_campaign_id_kind_opponent_name_key" ON "race_opponent_research"("campaign_id", "kind", "opponent_name") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "race_opponent_finding_research_id_occurred_at_idx" ON "race_opponent_finding"("research_id", "occurred_at");

-- CreateIndex
CREATE INDEX "race_opponent_contrast_campaign_id_status_idx" ON "race_opponent_contrast"("campaign_id", "status");

-- AddForeignKey
ALTER TABLE "race_opponent_research" ADD CONSTRAINT "race_opponent_research_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_opponent_finding" ADD CONSTRAINT "race_opponent_finding_research_id_fkey" FOREIGN KEY ("research_id") REFERENCES "race_opponent_research"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_opponent_contrast" ADD CONSTRAINT "race_opponent_contrast_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_opponent_contrast" ADD CONSTRAINT "race_opponent_contrast_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "race_opponent_finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_opponent_contrast" ADD CONSTRAINT "race_opponent_contrast_routed_story_id_fkey" FOREIGN KEY ("routed_story_id") REFERENCES "campaign_story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_opponent_contrast" ADD CONSTRAINT "race_opponent_contrast_routed_outreach_id_fkey" FOREIGN KEY ("routed_outreach_id") REFERENCES "outreach"("id") ON DELETE SET NULL ON UPDATE CASCADE;


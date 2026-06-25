-- CreateEnum
CREATE TYPE "CommunityIssueFeedList" AS ENUM ('top_community', 'trending');

-- CreateEnum
CREATE TYPE "CommunityIssueFeedCategory" AS ENUM ('infrastructure_and_transportation', 'public_safety', 'education', 'housing_and_development', 'health_and_human_services', 'economic_development', 'quality_of_life', 'government_operations', 'other');

-- CreateEnum
CREATE TYPE "CommunityIssueFeedPriority" AS ENUM ('low', 'medium', 'high');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ArtifactReviewResourceType" ADD VALUE 'community_issues_top';
ALTER TYPE "ArtifactReviewResourceType" ADD VALUE 'community_issues_trending';

-- AlterEnum
ALTER TYPE "PrioritySource" ADD VALUE 'community_issue_feed';

-- AlterTable
ALTER TABLE "chat_conversation" ADD COLUMN     "anchor" JSONB;

-- AlterTable
ALTER TABLE "priority" ADD COLUMN     "source_community_issue_feed_id" TEXT;

-- CreateTable
CREATE TABLE "community_issue_feed" (
    "id" TEXT NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "list" "CommunityIssueFeedList" NOT NULL,
    "category" "CommunityIssueFeedCategory" NOT NULL,
    "priority" "CommunityIssueFeedPriority" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "rank" INTEGER,
    "archived_at" TIMESTAMP(3),
    "last_refreshed_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_issue_feed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_briefing_item_link" (
    "id" TEXT NOT NULL,
    "meeting_briefing_id" TEXT NOT NULL,
    "briefing_item_id" TEXT NOT NULL,
    "priority_id" TEXT,
    "community_issue_feed_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_briefing_item_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_issue_feed_organization_slug_list_archived_at_ran_idx" ON "community_issue_feed"("organization_slug", "list", "archived_at", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_briefing_item_link_meeting_briefing_id_briefing_ite_key" ON "meeting_briefing_item_link"("meeting_briefing_id", "briefing_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "priority_source_community_issue_feed_id_key" ON "priority"("source_community_issue_feed_id");

-- AddForeignKey
ALTER TABLE "community_issue_feed" ADD CONSTRAINT "community_issue_feed_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_briefing_item_link" ADD CONSTRAINT "meeting_briefing_item_link_meeting_briefing_id_fkey" FOREIGN KEY ("meeting_briefing_id") REFERENCES "meeting_briefing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_briefing_item_link" ADD CONSTRAINT "meeting_briefing_item_link_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "priority"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_briefing_item_link" ADD CONSTRAINT "meeting_briefing_item_link_community_issue_feed_id_fkey" FOREIGN KEY ("community_issue_feed_id") REFERENCES "community_issue_feed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority" ADD CONSTRAINT "priority_source_community_issue_feed_id_fkey" FOREIGN KEY ("source_community_issue_feed_id") REFERENCES "community_issue_feed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

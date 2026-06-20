-- CreateEnum
CREATE TYPE "CommunityIssueList" AS ENUM ('top_community', 'trending');

-- CreateEnum
CREATE TYPE "CommunityIssueCategory" AS ENUM ('infrastructure_and_transportation', 'public_safety', 'education', 'housing_and_development', 'health_and_human_services', 'economic_development', 'quality_of_life', 'government_operations', 'other');

-- CreateEnum
CREATE TYPE "CommunityIssuePriority" AS ENUM ('low', 'medium', 'high');

-- AlterEnum
BEGIN;
CREATE TYPE "PrioritySource_new" AS ENUM ('win_import', 'user_stated', 'community_issue');
ALTER TABLE "priority" ALTER COLUMN "source" TYPE "PrioritySource_new" USING ("source"::text::"PrioritySource_new");
ALTER TYPE "PrioritySource" RENAME TO "PrioritySource_old";
ALTER TYPE "PrioritySource_new" RENAME TO "PrioritySource";
DROP TYPE "public"."PrioritySource_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "community_issue" DROP CONSTRAINT "community_issue_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "community_issue_feed" DROP CONSTRAINT "community_issue_feed_organization_slug_fkey";

-- DropForeignKey
ALTER TABLE "community_issue_status_log" DROP CONSTRAINT "community_issue_status_log_community_issue_uuid_fkey";

-- DropForeignKey
ALTER TABLE "meeting_briefing_item_link" DROP CONSTRAINT "meeting_briefing_item_link_community_issue_feed_id_fkey";

-- DropForeignKey
ALTER TABLE "priority" DROP CONSTRAINT "priority_source_community_issue_feed_id_fkey";

-- DropIndex
DROP INDEX "priority_source_community_issue_feed_id_key";

-- AlterTable
ALTER TABLE "community_issue" DROP CONSTRAINT "community_issue_pkey",
DROP COLUMN "attachments",
DROP COLUMN "campaignId",
DROP COLUMN "channel",
DROP COLUMN "description",
DROP COLUMN "status",
DROP COLUMN "uuid",
ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "category" "CommunityIssueCategory" NOT NULL,
ADD COLUMN     "detail" JSONB,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "last_refreshed_run_id" TEXT,
ADD COLUMN     "list" "CommunityIssueList" NOT NULL,
ADD COLUMN     "organization_slug" TEXT NOT NULL,
ADD COLUMN     "priority" "CommunityIssuePriority" NOT NULL,
ADD COLUMN     "rank" INTEGER,
ADD COLUMN     "summary" TEXT NOT NULL,
ADD CONSTRAINT "community_issue_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "meeting_briefing_item_link" DROP COLUMN "community_issue_feed_id",
ADD COLUMN     "community_issue_id" TEXT;

-- AlterTable
ALTER TABLE "priority" DROP COLUMN "source_community_issue_feed_id",
ADD COLUMN     "source_community_issue_id" TEXT;

-- DropTable
DROP TABLE "community_issue_feed";

-- DropTable
DROP TABLE "community_issue_status_log";

-- DropEnum
DROP TYPE "CommunityIssueFeedCategory";

-- DropEnum
DROP TYPE "CommunityIssueFeedList";

-- DropEnum
DROP TYPE "CommunityIssueFeedPriority";

-- DropEnum
DROP TYPE "IssueChannel";

-- DropEnum
DROP TYPE "IssueStatus";

-- CreateIndex
CREATE INDEX "community_issue_organization_slug_list_archived_at_rank_idx" ON "community_issue"("organization_slug", "list", "archived_at", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "priority_source_community_issue_id_key" ON "priority"("source_community_issue_id");

-- AddForeignKey
ALTER TABLE "community_issue" ADD CONSTRAINT "community_issue_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_briefing_item_link" ADD CONSTRAINT "meeting_briefing_item_link_community_issue_id_fkey" FOREIGN KEY ("community_issue_id") REFERENCES "community_issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority" ADD CONSTRAINT "priority_source_community_issue_id_fkey" FOREIGN KEY ("source_community_issue_id") REFERENCES "community_issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

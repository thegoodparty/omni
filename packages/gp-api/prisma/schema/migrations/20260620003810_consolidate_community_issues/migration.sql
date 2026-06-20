-- Consolidate Community Issues onto the clean `community_issue` name.
--
-- Strategy: drop the DEAD campaign-side `community_issue` + status-log tables,
-- then RENAME the Serve feature's `community_issue_feed` table/enums/columns/
-- constraints onto the freed name. A rename preserves all existing rows and
-- avoids `ADD COLUMN ... NOT NULL` on a populated table. `community_issue_feed`
-- always exists when this runs because the prior migration
-- (202606190132160_add_community_issue_feed) applies immediately before it in
-- every environment.

-- AlterEnum: narrow PrioritySource, remapping the interim `community_issue_feed`
-- value (added by the prior migration) to `community_issue` so the cast cannot
-- throw on any row written under the prior naming.
BEGIN;
CREATE TYPE "PrioritySource_new" AS ENUM ('win_import', 'user_stated', 'community_issue');
ALTER TABLE "priority" ALTER COLUMN "source" TYPE "PrioritySource_new" USING (
  CASE "source"::text
    WHEN 'community_issue_feed' THEN 'community_issue'
    ELSE "source"::text
  END::"PrioritySource_new"
);
ALTER TYPE "PrioritySource" RENAME TO "PrioritySource_old";
ALTER TYPE "PrioritySource_new" RENAME TO "PrioritySource";
DROP TYPE "public"."PrioritySource_old";
COMMIT;

-- Drop the dead campaign-side community_issue feature (unused, empty in prod).
-- DROP TABLE handles any rows, so this is safe even where stale rows exist.
ALTER TABLE "community_issue_status_log" DROP CONSTRAINT "community_issue_status_log_community_issue_uuid_fkey";
ALTER TABLE "community_issue" DROP CONSTRAINT "community_issue_campaignId_fkey";
DROP TABLE "community_issue_status_log";
DROP TABLE "community_issue";
DROP TYPE "IssueChannel";
DROP TYPE "IssueStatus";

-- Rename the Serve feature's enums onto the clean names.
ALTER TYPE "CommunityIssueFeedList" RENAME TO "CommunityIssueList";
ALTER TYPE "CommunityIssueFeedCategory" RENAME TO "CommunityIssueCategory";
ALTER TYPE "CommunityIssueFeedPriority" RENAME TO "CommunityIssuePriority";

-- Rename the feature table onto the freed name + align its constraint/index
-- names with what Prisma derives for `community_issue`. Postgres FKs reference
-- tables by identity, not name, so the table rename keeps existing references
-- (priority, meeting_briefing_item_link) valid — we only realign names.
ALTER TABLE "community_issue_feed" RENAME TO "community_issue";
ALTER TABLE "community_issue" RENAME CONSTRAINT "community_issue_feed_pkey" TO "community_issue_pkey";
ALTER TABLE "community_issue" RENAME CONSTRAINT "community_issue_feed_organization_slug_fkey" TO "community_issue_organization_slug_fkey";
ALTER INDEX "community_issue_feed_organization_slug_list_archived_at_ran_idx" RENAME TO "community_issue_organization_slug_list_archived_at_rank_idx";

-- Rename the cross-table FK columns (+ their unique index / FK constraints).
-- Column renames preserve the stored ids, so existing prioritization and
-- briefing-item links survive intact.
ALTER TABLE "priority" RENAME COLUMN "source_community_issue_feed_id" TO "source_community_issue_id";
ALTER INDEX "priority_source_community_issue_feed_id_key" RENAME TO "priority_source_community_issue_id_key";
ALTER TABLE "priority" RENAME CONSTRAINT "priority_source_community_issue_feed_id_fkey" TO "priority_source_community_issue_id_fkey";
ALTER TABLE "meeting_briefing_item_link" RENAME COLUMN "community_issue_feed_id" TO "community_issue_id";
ALTER TABLE "meeting_briefing_item_link" RENAME CONSTRAINT "meeting_briefing_item_link_community_issue_feed_id_fkey" TO "meeting_briefing_item_link_community_issue_id_fkey";

-- Migrate chat anchors written under the prior (CommunityIssueFeed) naming so
-- ChatAnchorSchema.safeParse keeps resolving them (no-op where none exist).
UPDATE "chat_conversation"
SET "anchor" = jsonb_set("anchor", '{resourceType}', '"community_issue"')
WHERE "anchor" ->> 'resourceType' = 'community_issue_feed';

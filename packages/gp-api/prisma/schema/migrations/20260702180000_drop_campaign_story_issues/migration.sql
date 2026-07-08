-- Dropped with no backfill, mirroring the campaign_story.why drop: every
-- reader and writer moved to website issues (Website.content.about.issues,
-- ENG-10524/10607) and contrast routing followed (ENG-10603), so nothing
-- deployed references this column anymore.

-- AlterTable
ALTER TABLE "campaign_story" DROP COLUMN "issues";

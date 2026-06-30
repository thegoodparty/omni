-- The `why` is dropped outright with no backfill into the website bio: the
-- Campaign Story feature isn't live to real users yet, so there's no authored
-- why to preserve. The bio-based readers (website content.about.bio) take over.

-- AlterTable
ALTER TABLE "campaign_story" DROP COLUMN "why";

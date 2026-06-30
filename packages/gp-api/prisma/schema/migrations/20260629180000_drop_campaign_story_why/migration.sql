-- Backfill campaign_story.why into website.content.about.bio before dropping
-- the column, so a candidate who wrote a why on the Campaign Story page (which
-- the bio-based readers now use) doesn't lose it. why is plain text and the bio
-- is Quill HTML, so wrap it in <p> (serializeWebsiteBio strips it cleanly). Only
-- write where the bio is empty/absent so a bio the candidate authored in the
-- Pro-upgrade flow is never overwritten; the nested jsonb_set ensures the
-- `about` object exists first. Campaigns without a website row can't be
-- backfilled here (a website row can't be safely synthesized) and are left as-is.
UPDATE "website" w
SET "content" = jsonb_set(
  jsonb_set(
    COALESCE(w."content", '{}'::jsonb),
    '{about}',
    COALESCE(w."content" -> 'about', '{}'::jsonb),
    true
  ),
  '{about,bio}',
  to_jsonb('<p>' || cs."why" || '</p>'),
  true
)
FROM "campaign_story" cs
WHERE cs."campaign_id" = w."campaign_id"
  AND cs."why" IS NOT NULL
  AND cs."why" <> ''
  AND (
    w."content" -> 'about' ->> 'bio' IS NULL
    OR w."content" -> 'about' ->> 'bio' = ''
  );

-- AlterTable
ALTER TABLE "campaign_story" DROP COLUMN "why";

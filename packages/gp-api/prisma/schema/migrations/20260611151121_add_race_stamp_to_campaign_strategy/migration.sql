-- AlterTable
ALTER TABLE "campaign_strategy" ADD COLUMN     "previous_race_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "race_id" TEXT;

-- Backfill: stamp existing rows with their campaign's current raceId.
-- This blesses pre-existing content as belonging to the current race; any
-- already-stale rows (office changed before this fix existed) are accepted
-- as-is rather than triggering a regeneration stampede. Rows whose campaign
-- has no usable raceId stay NULL and are adopted lazily on first read.
UPDATE "campaign_strategy" cs
SET "race_id" = c.details->>'raceId'
FROM "campaign" c
WHERE c.id = cs.campaign_id
  AND cs.race_id IS NULL
  AND c.details->>'raceId' IS NOT NULL
  AND c.details->>'raceId' <> '';

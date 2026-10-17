-- Each race's own projected turnout with a 70% prediction interval, plus the
-- electorate the projection was drawn for and the inference timestamp.
-- Populated nightly by the gp-data-platform race mart; read-only for the API.
--
-- Nullable and defaultless on purpose: the nightly loader takes the live
-- table's own column list and inserts whatever the mart publishes, so a
-- NOT NULL would fail the whole load, and a default would fabricate a
-- projection for races the model's three-year horizon does not cover.

-- AlterTable
ALTER TABLE "Race" ADD COLUMN     "election_code" "ElectionCode",
ADD COLUMN     "inference_at" TIMESTAMP(3),
ADD COLUMN     "projected_turnout" INTEGER,
ADD COLUMN     "projected_turnout_lower" INTEGER,
ADD COLUMN     "projected_turnout_upper" INTEGER;

-- Rename the just-added term columns and convert them to date-only (no time precision).
ALTER TABLE "elected_office" RENAME COLUMN "term_start_at" TO "term_start_date";
ALTER TABLE "elected_office" RENAME COLUMN "term_end_at" TO "term_end_date";

ALTER TABLE "elected_office" ALTER COLUMN "term_start_date" TYPE DATE USING "term_start_date"::date;
ALTER TABLE "elected_office" ALTER COLUMN "term_end_date" TYPE DATE USING "term_end_date"::date;

-- New onboarding / status fields.
ALTER TABLE "elected_office" ADD COLUMN     "party" TEXT,
ADD COLUMN     "pledged_at" TIMESTAMP(3),
ADD COLUMN     "onboarding_completed_at" TIMESTAMP(3);

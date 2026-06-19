-- isActive and termLengthDays are now derived from the term dates at read time
-- (isActive = term_end_date is in the future; term_length_days = end - start),
-- so the stored columns are no longer needed.
ALTER TABLE "elected_office" DROP COLUMN "is_active";
ALTER TABLE "elected_office" DROP COLUMN "term_length_days";

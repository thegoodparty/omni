-- "Voted early or by mail" folds into "Voted in election", which now reads
-- L2's early and absentee voters too. Carry any saved choice over before the
-- columns go: Yes becomes already_voted, No becomes unknown. voted_status is
-- nullable, so a NULL is treated as empty.
UPDATE "voter_file_filter"
SET "voted_status" = array_append(COALESCE("voted_status", ARRAY[]::"VotedStatus"[]), 'already_voted'::"VotedStatus")
WHERE "early_absentee_voted_yes" = true
  AND NOT ('already_voted'::"VotedStatus" = ANY(COALESCE("voted_status", ARRAY[]::"VotedStatus"[])));

UPDATE "voter_file_filter"
SET "voted_status" = array_append(COALESCE("voted_status", ARRAY[]::"VotedStatus"[]), 'unknown'::"VotedStatus")
WHERE "early_absentee_voted_no" = true
  AND NOT ('unknown'::"VotedStatus" = ANY(COALESCE("voted_status", ARRAY[]::"VotedStatus"[])));

-- AlterTable
ALTER TABLE "voter_file_filter" DROP COLUMN "early_absentee_voted_no",
DROP COLUMN "early_absentee_voted_yes";

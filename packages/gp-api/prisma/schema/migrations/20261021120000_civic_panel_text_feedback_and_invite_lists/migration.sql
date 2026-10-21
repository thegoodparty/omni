-- AlterEnum
ALTER TYPE "ConstituentFeedbackChannel" ADD VALUE 'text';

-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN "civic_panel_invite" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: the lists our code already saved as civic panel invite audiences.
-- A build plan step's draw is the list its step points at. The panel's first
-- text saved its district draw as a sample named "Civic panel invite"; only a
-- chat card or the panel's own seed saves a sample, so a sample under that
-- exact name is ours. A list someone saved and named themselves is left as
-- it is, and nothing is deleted.
UPDATE "voter_file_filter"
SET "civic_panel_invite" = true
WHERE "id" IN (
    SELECT "voter_file_filter_id"
    FROM "civic_panel_build_step"
    WHERE "voter_file_filter_id" IS NOT NULL
  )
  OR (
    "name" = 'Civic panel invite'
    AND "sample_size" IS NOT NULL
    AND "organization_slug" LIKE 'eo-%'
  );

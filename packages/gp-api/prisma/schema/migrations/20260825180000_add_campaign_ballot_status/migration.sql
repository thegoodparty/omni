-- AlterTable
ALTER TABLE "campaign" ADD COLUMN "ballot_status" TEXT;

-- Backfill from the two JSONB copies onboarding has been writing, in the same
-- precedence every reader used: details first, then the whole-answers snapshot.
-- details.ballotStatus stopped being written on 2026-05-20 (94862c9df removed
-- .passthrough() from the details allowlist), so most rows only have the
-- snapshot.
UPDATE "campaign"
SET "ballot_status" = COALESCE(
  "details" ->> 'ballotStatus',
  "data" -> 'onboarding' ->> 'ballotStatus'
)
WHERE COALESCE(
  "details" ->> 'ballotStatus',
  "data" -> 'onboarding' ->> 'ballotStatus'
) IN ('on-ballot', 'qualified-not-filed', 'considering', 'testing');

-- Drop the details copy so the column is the only source of truth. The
-- snapshot under data.onboarding stays: it is the archive of what the
-- candidate answered at every onboarding step, not a read path.
UPDATE "campaign"
SET "details" = "details" - 'ballotStatus'
WHERE "details" ? 'ballotStatus';

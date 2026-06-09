-- Enforce NOT NULL on the Position ICP flags once the dbt mart backfill
-- has populated every row (gp-data-platform#473).
--
-- Do not deploy while any row is still null: SET NOT NULL fails on
-- remaining nulls, and the upstream mart writes null for offices whose
-- voter_count is unknown — those must be resolved (or coalesced upstream)
-- first.

ALTER TABLE "Position"
  ALTER COLUMN "is_win_icp" SET NOT NULL,
  ALTER COLUMN "is_serve_icp" SET NOT NULL;

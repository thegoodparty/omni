-- Office-level ICP eligibility flags at Position grain (DATA-1975).
--
-- Two nullable booleans populated by the m_election_api__position dbt mart
-- upsert (gp-data-platform#473). Null = the office's voter_count is unknown
-- in int__icp_offices. This migration must deploy before the mart change;
-- a follow-up migration sets NOT NULL once the backfill has run.

ALTER TABLE "Position"
  ADD COLUMN "is_win_icp" BOOLEAN,
  ADD COLUMN "is_serve_icp" BOOLEAN;

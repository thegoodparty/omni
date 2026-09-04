-- Drop the two density -> District foreign keys added in
-- 20260831000000_add_district_voter_density. They cannot survive in this
-- database, so leaving them declared guarantees permanent schema drift.
--
-- sync_election_api rebuilds District nightly by renaming the live table to
-- District_old and dropping it CASCADE. Verified against real Postgres: after
-- the rename these constraints point at the stale District_old, and the
-- CASCADE then removes them with only a NOTICE. The density rows survive, the
-- constraints do not, and orphan district_ids become insertable from then on.
-- Re-adding them on every density load would only cover the gap between runs
-- and would still drift.
--
-- The referential guarantee they were added for now lives in
-- gp-data-platform's sync_election_api_density DAG
-- (_district_reference_checks): every staged district_id is matched against
-- live District and a miss fails the load closed, before the swap. That is the
-- moment the constraint was doing real work, since nothing writes these tables
-- between loads — the API only reads them.

-- DropForeignKey
ALTER TABLE "District_Voter_Density" DROP CONSTRAINT "District_Voter_Density_district_id_fkey";

-- DropForeignKey
ALTER TABLE "District_Voter_Density_Meta" DROP CONSTRAINT "District_Voter_Density_Meta_district_id_fkey";

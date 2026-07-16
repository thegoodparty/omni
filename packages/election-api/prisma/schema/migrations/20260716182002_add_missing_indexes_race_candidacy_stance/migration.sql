-- Add btree indexes on hot foreign-key / filter columns that back gp-api reads.
--
-- Race.place_id: PositionsService.lookupFilingFee and getNextElectionForPosition
--   run `WHERE place_id = ? AND position_names @> ?` on every filing-fee /
--   next-election lookup. Race covers BallotReady's full US dataset, so the
--   unindexed column forces a sequential scan on each read.
-- Candidacy.race_id: RacesService include-candidacies and CandidaciesService
--   join candidacies to a race by FK; the column was unindexed.
-- Stance.candidacy_id / issue_id: CandidaciesService include-stances joins
--   stances by candidacy, and every Stance carries an Issue FK; both were
--   unindexed. Matches the @@index declarations added to prisma/schema.
--
-- NOTE: intentionally NOT `CREATE INDEX CONCURRENTLY`. election-api applies
-- migrations via `prisma migrate deploy` in its container entrypoint
-- (deploy/entrypoint.sh), which runs each migration inside a transaction;
-- CONCURRENTLY errors there with "cannot run inside a transaction block" and
-- would crash-loop the container on startup. (people-api can use CONCURRENTLY
-- only because its entrypoint doesn't run migrate deploy.) A plain CREATE INDEX
-- takes a brief write lock for the build — acceptable on these ingestion-fed
-- tables and consistent with the existing Race.br_hash_id index migration.
-- IF NOT EXISTS keeps re-runs idempotent.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Candidacy_race_id_idx" ON "Candidacy"("race_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Race_place_id_idx" ON "Race"("place_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Stance_candidacy_id_idx" ON "Stance"("candidacy_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Stance_issue_id_idx" ON "Stance"("issue_id");

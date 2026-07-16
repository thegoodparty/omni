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

-- CreateIndex
CREATE INDEX "Candidacy_race_id_idx" ON "Candidacy"("race_id");

-- CreateIndex
CREATE INDEX "Race_place_id_idx" ON "Race"("place_id");

-- CreateIndex
CREATE INDEX "Stance_candidacy_id_idx" ON "Stance"("candidacy_id");

-- CreateIndex
CREATE INDEX "Stance_issue_id_idx" ON "Stance"("issue_id");

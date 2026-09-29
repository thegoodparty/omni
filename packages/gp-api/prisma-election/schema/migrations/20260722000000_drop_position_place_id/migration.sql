-- Drop Position.place_id. The Position→Place FK plus position-name match against
-- Race.position_names that it backed (PositionsService.lookupFilingFee and
-- getNextElectionForPosition) is replaced by the Race.position_id FK, which
-- BallotReady maintains per election schedule. Position.place_id was never
-- populated by the m_election_api__position dbt mart, so nothing depended on its
-- value. Race.place_id (and its index) is unrelated and stays.

-- DropForeignKey
ALTER TABLE "Position" DROP CONSTRAINT "Position_place_id_fkey";

-- DropIndex
DROP INDEX "Position_place_id_idx";

-- AlterTable
ALTER TABLE "Position" DROP COLUMN "place_id";

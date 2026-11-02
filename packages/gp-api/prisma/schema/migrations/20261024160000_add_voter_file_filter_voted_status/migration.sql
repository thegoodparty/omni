-- CreateEnum
CREATE TYPE "VotedStatus" AS ENUM ('already_voted', 'unknown');

-- AlterTable
-- "Voted in election" on a saved list (Win only). Empty means no constraint,
-- so every existing list keeps its audience.
ALTER TABLE "voter_file_filter" ADD COLUMN "voted_status" "VotedStatus"[] DEFAULT ARRAY[]::"VotedStatus"[];

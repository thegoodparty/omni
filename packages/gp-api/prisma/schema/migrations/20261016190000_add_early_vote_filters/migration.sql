-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "early_vote_likely" BOOLEAN DEFAULT false,
ADD COLUMN     "early_vote_unknown" BOOLEAN DEFAULT false,
ADD COLUMN     "early_vote_unlikely" BOOLEAN DEFAULT false,
ADD COLUMN     "early_vote_very_likely" BOOLEAN DEFAULT false,
ADD COLUMN     "early_vote_very_unlikely" BOOLEAN DEFAULT false;

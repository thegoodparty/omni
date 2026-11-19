-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "early_absentee_voted_no" BOOLEAN DEFAULT false,
ADD COLUMN     "early_absentee_voted_yes" BOOLEAN DEFAULT false;

-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "precincts" TEXT[] DEFAULT ARRAY[]::TEXT[];

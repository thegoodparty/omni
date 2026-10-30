-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "source" TEXT[] DEFAULT ARRAY[]::TEXT[];

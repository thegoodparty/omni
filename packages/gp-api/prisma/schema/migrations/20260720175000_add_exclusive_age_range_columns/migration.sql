-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "age_18_24" BOOLEAN DEFAULT false,
ADD COLUMN     "age_25_34" BOOLEAN DEFAULT false,
ADD COLUMN     "age_35_49" BOOLEAN DEFAULT false,
ADD COLUMN     "age_50_64" BOOLEAN DEFAULT false,
ADD COLUMN     "age_65_plus" BOOLEAN DEFAULT false;


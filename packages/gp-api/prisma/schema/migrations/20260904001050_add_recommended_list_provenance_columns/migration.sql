-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "recommended_channel" TEXT,
ADD COLUMN     "recommended_intent" TEXT,
ADD COLUMN     "recommended_modified" BOOLEAN,
ADD COLUMN     "recommended_variant" TEXT;

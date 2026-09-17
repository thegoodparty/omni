-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "has_address" BOOLEAN DEFAULT false,
ADD COLUMN     "has_any_phone" BOOLEAN DEFAULT false,
ADD COLUMN     "ideology_conservative" BOOLEAN DEFAULT false,
ADD COLUMN     "ideology_liberal" BOOLEAN DEFAULT false,
ADD COLUMN     "ideology_moderate" BOOLEAN DEFAULT false,
ADD COLUMN     "ideology_unknown" BOOLEAN DEFAULT false,
ADD COLUMN     "independent_affinity" BOOLEAN DEFAULT false;

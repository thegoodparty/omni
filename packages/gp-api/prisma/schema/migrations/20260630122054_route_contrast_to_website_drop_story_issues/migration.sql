-- DropForeignKey
ALTER TABLE "race_opponent_contrast" DROP CONSTRAINT "race_opponent_contrast_routed_story_id_fkey";

-- AlterTable
ALTER TABLE "campaign_story" DROP COLUMN "issues";

-- AlterTable
ALTER TABLE "race_opponent_contrast" DROP COLUMN "routed_story_id",
ADD COLUMN     "routed_website_id" INTEGER;

-- AddForeignKey
ALTER TABLE "race_opponent_contrast" ADD CONSTRAINT "race_opponent_contrast_routed_website_id_fkey" FOREIGN KEY ("routed_website_id") REFERENCES "website"("id") ON DELETE SET NULL ON UPDATE CASCADE;


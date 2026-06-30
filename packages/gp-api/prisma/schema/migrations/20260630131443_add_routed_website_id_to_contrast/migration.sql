-- AlterTable
ALTER TABLE "race_opponent_contrast" ADD COLUMN     "routed_website_id" INTEGER;

-- AddForeignKey
ALTER TABLE "race_opponent_contrast" ADD CONSTRAINT "race_opponent_contrast_routed_website_id_fkey" FOREIGN KEY ("routed_website_id") REFERENCES "website"("id") ON DELETE SET NULL ON UPDATE CASCADE;


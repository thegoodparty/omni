-- AlterTable
ALTER TABLE "outreach_robocall" ADD COLUMN     "promo_code" TEXT,
ADD COLUMN     "promo_covers_total" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promo_discount_in_cents" INTEGER,
ADD COLUMN     "promo_redeemed_at" TIMESTAMP(3),
ADD COLUMN     "promotion_code_id" TEXT;


-- AlterTable
ALTER TABLE "outreach_p2p_sms" ADD COLUMN     "promo_covers_total" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promo_discount_in_cents" INTEGER,
ADD COLUMN     "promotion_code_id" TEXT;

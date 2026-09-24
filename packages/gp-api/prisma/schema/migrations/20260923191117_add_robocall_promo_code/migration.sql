-- AlterTable
ALTER TABLE "outreach_robocall" ADD COLUMN     "promo_code" TEXT,
ADD COLUMN     "promo_covers_total" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promo_discount_in_cents" INTEGER,
ADD COLUMN     "promo_redeemed_at" TIMESTAMP(3),
ADD COLUMN     "promotion_code_id" TEXT;

-- One redemption per promotion code. Two robocalls may REMEMBER the same code,
-- but only one may stamp it redeemed; the pre-check in the promo service is a
-- read and cannot close the race between two concurrent authorizes.
CREATE UNIQUE INDEX "outreach_robocall_promotion_code_id_redeemed_key"
  ON "outreach_robocall" ("promotion_code_id")
  WHERE "promo_redeemed_at" IS NOT NULL;

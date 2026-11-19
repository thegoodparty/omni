-- CreateEnum
CREATE TYPE "CampaignPlanLevel" AS ENUM ('free', 'pro', 'team');

-- CreateEnum
CREATE TYPE "PlanPricingModel" AS ENUM ('subscription', 'one_time');

-- CreateEnum
CREATE TYPE "CampaignPlanPurchaseKind" AS ENUM ('plan', 'team_upgrade');

-- CreateEnum
CREATE TYPE "CampaignPlanPurchaseStatus" AS ENUM ('paid', 'refunded');

-- AlterTable
ALTER TABLE "campaign" ADD COLUMN     "outreach_credit_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "plan" "CampaignPlanLevel" NOT NULL DEFAULT 'free',
ADD COLUMN     "plan_ended_at" TIMESTAMP(3),
ADD COLUMN     "plan_ends_at_override" TIMESTAMP(3),
ADD COLUMN     "plan_paid_at" TIMESTAMP(3),
ADD COLUMN     "plan_pricing_model" "PlanPricingModel";

-- AlterTable
ALTER TABLE "outreach" ADD COLUMN     "credit_reserved_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "credit_settled_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "campaign_plan_purchase" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "buyer_user_id" INTEGER NOT NULL,
    "kind" "CampaignPlanPurchaseKind" NOT NULL,
    "plan" "CampaignPlanLevel",
    "amount_cents" INTEGER NOT NULL,
    "credit_granted_cents" INTEGER NOT NULL DEFAULT 0,
    "stripe_checkout_session_id" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "payment_method_type" TEXT,
    "status" "CampaignPlanPurchaseStatus" NOT NULL DEFAULT 'paid',
    "refunded_at" TIMESTAMP(3),
    "refunded_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_plan_purchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_plan_purchase_stripe_checkout_session_id_key" ON "campaign_plan_purchase"("stripe_checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_plan_purchase_stripe_payment_intent_id_key" ON "campaign_plan_purchase"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "campaign_plan_purchase_campaign_id_idx" ON "campaign_plan_purchase"("campaign_id");

-- AddForeignKey
ALTER TABLE "campaign_plan_purchase" ADD CONSTRAINT "campaign_plan_purchase_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A credit balance below zero would mean spending credit that was never granted.
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_outreach_credit_cents_nonnegative" CHECK ("outreach_credit_cents" >= 0);

-- Grandfathered subscribers. Comped Pro campaigns (is_pro, no subscriptionId)
-- stay on free until product confirms they become one-time plans.
UPDATE "campaign"
SET "plan" = 'pro', "plan_pricing_model" = 'subscription'
WHERE "details"->>'subscriptionId' IS NOT NULL AND "is_pro" = true;

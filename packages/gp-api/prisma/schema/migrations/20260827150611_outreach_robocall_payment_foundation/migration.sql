-- CreateEnum
CREATE TYPE "RobocallSettleState" AS ENUM ('pending_payment', 'authorized', 'settling', 'captured', 'charged', 'voided', 'cancelled', 'disputed', 'uncollectable');

-- CreateTable
CREATE TABLE "outreach_robocall" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "audio_key" TEXT NOT NULL,
    "callback_number" TEXT NOT NULL,
    "billable_count" INTEGER NOT NULL,
    "amount_in_cents" INTEGER NOT NULL,
    "stripe_customer_id" TEXT,
    "payment_method_id" TEXT,
    "callhub_campaign_pk_str" TEXT,
    "callhub_starting_date" TIMESTAMP(3),
    "callhub_expiration_date" TIMESTAMP(3),
    "authorization_intent_id" TEXT,
    "authorized_amount_in_cents" INTEGER,
    "capture_before" TIMESTAMP(3),
    "captured_amount_in_cents" INTEGER,
    "charge_intent_id" TEXT,
    "pay_attempt" INTEGER NOT NULL DEFAULT 0,
    "settle_state" "RobocallSettleState" NOT NULL DEFAULT 'pending_payment',

    CONSTRAINT "outreach_robocall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_robocall_outreach_id_key" ON "outreach_robocall"("outreach_id");

-- AddForeignKey
ALTER TABLE "outreach_robocall" ADD CONSTRAINT "outreach_robocall_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;


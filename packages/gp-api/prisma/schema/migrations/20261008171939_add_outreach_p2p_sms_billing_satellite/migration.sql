-- CreateEnum
CREATE TYPE "P2pSmsSettleState" AS ENUM ('pending_payment', 'hold_pending', 'authorized', 'capturing', 'captured', 'voided', 'refunded', 'hold_failed');

-- CreateTable
CREATE TABLE "outreach_p2p_sms" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "authorization_intent_id" TEXT,
    "authorized_amount_in_cents" INTEGER,
    "captured_amount_in_cents" INTEGER,
    "charge_intent_id" TEXT,
    "capture_before" TIMESTAMP(3),
    "pay_attempt" INTEGER NOT NULL DEFAULT 0,
    "peerly_phone_list_id" TEXT,
    "settle_state" "P2pSmsSettleState" NOT NULL DEFAULT 'pending_payment',

    CONSTRAINT "outreach_p2p_sms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_p2p_sms_outreach_id_key" ON "outreach_p2p_sms"("outreach_id");

-- AddForeignKey
ALTER TABLE "outreach_p2p_sms" ADD CONSTRAINT "outreach_p2p_sms_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_p2p_sms" ADD CONSTRAINT "outreach_p2p_sms_peerly_phone_list_id_fkey" FOREIGN KEY ("peerly_phone_list_id") REFERENCES "peerly_phone_list"("id") ON DELETE SET NULL ON UPDATE CASCADE;

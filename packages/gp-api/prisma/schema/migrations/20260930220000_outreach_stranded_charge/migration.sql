-- A captured payment for a send the vendor permanently refused. Nothing else
-- records one: outreach.stripe_checkout_session_id is written only when a send
-- schedules, so before this table a stranded charge existed only in Stripe.

-- CreateTable
CREATE TABLE "outreach_stranded_charge" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "checkout_session_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refunded_at" TIMESTAMP(3),

    CONSTRAINT "outreach_stranded_charge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_stranded_charge_checkout_session_id_key" ON "outreach_stranded_charge"("checkout_session_id");

-- CreateIndex
CREATE INDEX "outreach_stranded_charge_campaign_id_idx" ON "outreach_stranded_charge"("campaign_id");

-- AddForeignKey
ALTER TABLE "outreach_stranded_charge" ADD CONSTRAINT "outreach_stranded_charge_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

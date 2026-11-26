-- CreateTable
CREATE TABLE "outreach_sms_delivery" (
    "outreach_id" INTEGER NOT NULL,
    "delivered" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "unconfirmed" INTEGER NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_sms_delivery_pkey" PRIMARY KEY ("outreach_id")
);

-- AddForeignKey
ALTER TABLE "outreach_sms_delivery" ADD CONSTRAINT "outreach_sms_delivery_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

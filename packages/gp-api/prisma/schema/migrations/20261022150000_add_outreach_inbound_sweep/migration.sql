-- CreateTable
CREATE TABLE "outreach_inbound_sweep" (
    "outreach_id" INTEGER NOT NULL,
    "swept_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_inbound_sweep_pkey" PRIMARY KEY ("outreach_id")
);

-- AddForeignKey
ALTER TABLE "outreach_inbound_sweep" ADD CONSTRAINT "outreach_inbound_sweep_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

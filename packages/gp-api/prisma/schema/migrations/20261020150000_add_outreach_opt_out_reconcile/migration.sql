-- CreateTable
CREATE TABLE "outreach_opt_out_reconcile" (
    "outreach_id" INTEGER NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_opt_out_reconcile_pkey" PRIMARY KEY ("outreach_id")
);

-- AddForeignKey
ALTER TABLE "outreach_opt_out_reconcile" ADD CONSTRAINT "outreach_opt_out_reconcile_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "outreach" ADD COLUMN "round_one_outreach_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "outreach_round_one_outreach_id_key" ON "outreach"("round_one_outreach_id");

-- AddForeignKey
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_round_one_outreach_id_fkey" FOREIGN KEY ("round_one_outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "DashboardCardType" ADD VALUE 'report_back';

-- AlterTable
ALTER TABLE "outreach" ADD COLUMN "report_back_for_outreach_id" INTEGER;

-- CreateIndex
CREATE INDEX "outreach_report_back_for_outreach_id_idx" ON "outreach"("report_back_for_outreach_id");

-- AddForeignKey
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_report_back_for_outreach_id_fkey" FOREIGN KEY ("report_back_for_outreach_id") REFERENCES "outreach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

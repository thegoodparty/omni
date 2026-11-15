-- CreateEnum
CREATE TYPE "OutreachFunding" AS ENUM ('goodparty_pilot');

-- The wave-to-send link moves onto outreach so a free send's funding and its
-- wave live on one row. No wave row has ever been written, so nothing is lost.

-- DropForeignKey
ALTER TABLE "managed_panel_wave" DROP CONSTRAINT "managed_panel_wave_outreach_id_fkey";

-- DropIndex
DROP INDEX "managed_panel_wave_outreach_id_key";

-- AlterTable
ALTER TABLE "managed_panel_wave" DROP COLUMN "outreach_id";

-- AlterTable
ALTER TABLE "outreach" ADD COLUMN     "funded_by" "OutreachFunding",
ADD COLUMN     "managed_panel_wave_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "outreach_managed_panel_wave_id_key" ON "outreach"("managed_panel_wave_id");

-- AddForeignKey
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_managed_panel_wave_id_fkey" FOREIGN KEY ("managed_panel_wave_id") REFERENCES "managed_panel_wave"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- A free send must name the managed wave it was for, and is never also a
-- paid one. Not modeled in Prisma: the schema cannot express a CHECK.
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_funded_by_needs_managed_wave"
  CHECK ("funded_by" IS NULL OR "managed_panel_wave_id" IS NOT NULL);

ALTER TABLE "outreach" ADD CONSTRAINT "outreach_funded_by_not_paid"
  CHECK ("funded_by" IS NULL OR "stripe_checkout_session_id" IS NULL);

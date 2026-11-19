-- AlterTable
ALTER TABLE "managed_civic_panel" ADD COLUMN "confirmation_due_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "outreach" ADD COLUMN "managed_panel_confirmation_for_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "outreach_managed_panel_confirmation_for_id_key" ON "outreach"("managed_panel_confirmation_for_id");

-- AddForeignKey
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_managed_panel_confirmation_for_id_fkey" FOREIGN KEY ("managed_panel_confirmation_for_id") REFERENCES "managed_civic_panel"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Each free funding names what it is for: a pilot wave its wave, a panel
-- confirmation its panel. Not modeled in Prisma: the schema cannot express a
-- CHECK. Compared as text, because a migration replay that runs as one
-- transaction may not read an enum value added in that same transaction.
ALTER TABLE "outreach" DROP CONSTRAINT "outreach_funded_by_needs_managed_wave";

ALTER TABLE "outreach" ADD CONSTRAINT "outreach_funded_by_needs_its_link"
  CHECK (
    "funded_by" IS NULL
    OR ("funded_by"::text = 'goodparty_pilot' AND "managed_panel_wave_id" IS NOT NULL)
    OR (
      "funded_by"::text = 'goodparty_panel_confirmation'
      AND "managed_panel_confirmation_for_id" IS NOT NULL
    )
  );

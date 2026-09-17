-- DropForeignKey
ALTER TABLE "outreach" DROP CONSTRAINT "outreach_organization_slug_fkey";

-- AlterTable
ALTER TABLE "outreach" ALTER COLUMN "campaignId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "outreach_organization_slug_idx" ON "outreach"("organization_slug");

-- AddForeignKey
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every row needs at least one scoping path: campaignId (Win) or
-- organization_slug (Serve). No NOT VALID needed — every existing row
-- already carries a campaignId, so this can never fail on the backfill scan.
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_scope_check"
  CHECK ("campaignId" IS NOT NULL OR "organization_slug" IS NOT NULL);

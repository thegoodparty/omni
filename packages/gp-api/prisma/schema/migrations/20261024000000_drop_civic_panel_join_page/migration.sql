-- A joiner the voter file did not hold was its own personId. With the table
-- gone nothing could reach that person again (no STOP or LEAVE), so take
-- them off the panel: drop every status they hold.
DELETE FROM "contact_current_status" AS s
USING "civic_panel_joiner" AS j
WHERE s."organization_slug" = j."organization_slug"
  AND s."person_id" = j."id";

DELETE FROM "contact_status_event" AS e
USING "civic_panel_joiner" AS j
WHERE e."organization_slug" = j."organization_slug"
  AND e."person_id" = j."id";

-- DropForeignKey
ALTER TABLE "civic_panel_joiner" DROP CONSTRAINT "civic_panel_joiner_organization_slug_fkey";

-- DropIndex
DROP INDEX "managed_civic_panel_share_code_key";

-- AlterTable
ALTER TABLE "managed_civic_panel" DROP COLUMN "share_code";

-- DropTable
DROP TABLE "civic_panel_joiner";

-- DropEnum
DROP TYPE "CivicPanelJoinSource";

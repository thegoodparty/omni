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

-- Nobody joins from the page now, and its phones were never verified, so
-- anyone whose civic panel status last came from it is off the panel too,
-- and the page's events go. Enums are compared as text: a fresh database
-- replays every migration in one transaction, and Postgres refuses an enum
-- value added there before it is committed.
DELETE FROM "contact_current_status" AS s
USING (
  SELECT DISTINCT ON ("organization_slug", "person_id")
    "organization_slug", "person_id", "source"::text AS "source"
  FROM "contact_status_event"
  WHERE "field"::text = 'civic_panel'
  ORDER BY "organization_slug", "person_id", "created_at" DESC, "id" DESC
) AS latest
WHERE latest."source" = 'share_page'
  AND s."organization_slug" = latest."organization_slug"
  AND s."person_id" = latest."person_id"
  AND s."field"::text = 'civic_panel';

DELETE FROM "contact_status_event" WHERE "source"::text = 'share_page';

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

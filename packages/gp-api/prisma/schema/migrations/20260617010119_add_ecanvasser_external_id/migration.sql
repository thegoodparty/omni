-- AlterTable
ALTER TABLE "ecanvasser_contact" ADD COLUMN     "external_id" INTEGER;

-- AlterTable
ALTER TABLE "ecanvasser_interaction" ADD COLUMN     "external_id" INTEGER;

-- Pre-existing rows have a null external_id, which attribution skips. The delta
-- sync never repopulates them (only a full sync recreates rows), so without this
-- a new interaction referencing a contact synced before this migration would be
-- silently unattributable. Reset last_sync so each integration's next sync runs
-- full and backfills external_id across all contacts/interactions.
UPDATE "ecanvasser" SET "last_sync" = NULL;

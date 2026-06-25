-- AlterTable
ALTER TABLE "ecanvasser_house" ADD COLUMN     "external_id" INTEGER;

-- The delta sync used to append rows (nested create, not upsert), so an
-- overlapping sync window could insert duplicate contacts/interactions sharing
-- the same eCanvasser API id (external_id). De-duplicate those before adding the
-- unique index below, or the CREATE UNIQUE INDEX would fail on the existing
-- duplicates. Rows with a NULL external_id are pre-ENG-10429 and never collide
-- (NULLs are distinct in a Postgres unique index), so they are left untouched.

-- Dedupe ecanvasser_contact: keep the best row per (ecanvasser_id, external_id),
-- matching EcanvasserAttributionService.isFresherContact — a row with a phone
-- (mobile or home) beats one without, then the most recently synced (highest id)
-- wins. Delete the rest.
DELETE FROM "ecanvasser_contact" c
USING (
  SELECT id,
    row_number() OVER (
      PARTITION BY "ecanvasser_id", "external_id"
      ORDER BY
        (("mobile_phone" IS NOT NULL) OR ("home_phone" IS NOT NULL)) DESC,
        id DESC
    ) AS rn
  FROM "ecanvasser_contact"
  WHERE "external_id" IS NOT NULL
) ranked
WHERE c.id = ranked.id
  AND ranked.rn > 1;

-- Dedupe ecanvasser_interaction: keep the most recently synced (highest id) row
-- per (ecanvasser_id, external_id); the external_id is the idempotency key for
-- the emitted VoterOutreachActivity, so a duplicate carries no extra information.
DELETE FROM "ecanvasser_interaction" i
USING (
  SELECT id,
    row_number() OVER (
      PARTITION BY "ecanvasser_id", "external_id"
      ORDER BY id DESC
    ) AS rn
  FROM "ecanvasser_interaction"
  WHERE "external_id" IS NOT NULL
) ranked
WHERE i.id = ranked.id
  AND ranked.rn > 1;

-- CreateIndex
CREATE UNIQUE INDEX "ecanvasser_contact_ecanvasser_id_external_id_key" ON "ecanvasser_contact"("ecanvasser_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "ecanvasser_house_ecanvasser_id_external_id_key" ON "ecanvasser_house"("ecanvasser_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "ecanvasser_interaction_ecanvasser_id_external_id_key" ON "ecanvasser_interaction"("ecanvasser_id", "external_id");

-- CreateTable
CREATE TABLE "peerly_phone_list" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "token" TEXT,
    "list_id" INTEGER,

    CONSTRAINT "peerly_phone_list_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "peerly_phone_list_token_key" ON "peerly_phone_list"("token");

-- CreateIndex
CREATE UNIQUE INDEX "peerly_phone_list_list_id_key" ON "peerly_phone_list"("list_id");

-- CreateIndex
CREATE INDEX "peerly_phone_list_campaign_id_idx" ON "peerly_phone_list"("campaign_id");

-- AddForeignKey
ALTER TABLE "peerly_phone_list" ADD CONSTRAINT "peerly_phone_list_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill ownership from existing P2P outreach rows so every phone list already
-- in use is bound to its owning campaign. One row per Peerly list_id. For a
-- list_id that appears under more than one campaign (only possible if a past
-- IDOR already occurred), assign it to the campaign that used it EARLIEST — the
-- original owner — rather than an arbitrary one. The unique list_id index is
-- additionally guarded by ON CONFLICT DO NOTHING.
-- NB: outreach.campaignId / outreach.createdAt have no @map, so the physical
-- columns are camelCase. Only phone_list_id is @map'd to snake_case.
-- The EXISTS guard skips any outreach row whose campaign no longer exists, so a
-- dangling campaignId can't FK-violate the insert and fail the migration.
INSERT INTO "peerly_phone_list" ("campaign_id", "list_id", "updated_at")
SELECT DISTINCT ON (o."phone_list_id")
    o."campaignId", o."phone_list_id", CURRENT_TIMESTAMP
FROM "outreach" o
WHERE o."phone_list_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "campaign" c WHERE c."id" = o."campaignId")
ORDER BY o."phone_list_id", o."createdAt"
ON CONFLICT ("list_id") DO NOTHING;

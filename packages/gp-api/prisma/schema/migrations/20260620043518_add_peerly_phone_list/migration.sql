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
-- in use is bound to its owning campaign. One row per Peerly list_id (DISTINCT
-- ON picks the lowest campaign_id deterministically); the unique list_id index
-- is additionally guarded by ON CONFLICT DO NOTHING.
INSERT INTO "peerly_phone_list" ("campaign_id", "list_id", "updated_at")
SELECT DISTINCT ON ("phone_list_id")
    "campaign_id", "phone_list_id", CURRENT_TIMESTAMP
FROM "outreach"
WHERE "phone_list_id" IS NOT NULL
ORDER BY "phone_list_id", "campaign_id"
ON CONFLICT DO NOTHING;

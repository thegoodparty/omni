-- CreateEnum
CREATE TYPE "PhoneListBuildStatus" AS ENUM ('queued', 'building', 'processing', 'ready', 'failed');

-- AlterTable
ALTER TABLE "peerly_phone_list" ADD COLUMN     "build_error" TEXT,
ADD COLUMN     "build_status" "PhoneListBuildStatus" NOT NULL DEFAULT 'queued',
ALTER COLUMN "token" DROP NOT NULL;

-- Backfill: every row that predates this column was built the old
-- synchronous way (token minted at insert), so none of them are actually
-- queued/building. A resolved peerly_list_id means Peerly already confirmed
-- the list; a token with no peerly_list_id yet means the status poll just
-- hasn't caught up.
UPDATE "peerly_phone_list"
SET "build_status" = 'ready'
WHERE "peerly_list_id" IS NOT NULL;

UPDATE "peerly_phone_list"
SET "build_status" = 'processing'
WHERE "peerly_list_id" IS NULL AND "token" IS NOT NULL;

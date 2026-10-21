-- AlterTable
ALTER TABLE "peerly_phone_list" ADD COLUMN     "build_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_seen_leads_loaded" INTEGER,
ADD COLUMN     "request_snapshot" JSONB;

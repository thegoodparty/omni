-- AlterTable
ALTER TABLE "outreach_robocall" ADD COLUMN     "dialing_started_at" TIMESTAMP(3);

-- Backfill rows already dialing at deploy: a null dialing_started_at is skipped
-- by the deadlock backstop (which filters on dialing_started_at IS NOT NULL), so
-- a genuinely-stuck pre-migration run could hold the serial queue forever. Seed
-- from updated_at (frozen here; stale recovery never bumps dialing_started_at) so
-- the backstop can still age it out.
UPDATE "outreach_robocall" SET "dialing_started_at" = "updated_at" WHERE "settle_state" = 'dialing' AND "dialing_started_at" IS NULL;

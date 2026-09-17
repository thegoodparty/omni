-- AlterTable
-- The completion sweep's per-run count snapshot: `completed_call_count` records
-- CallHub's actual completed/billable count (credits_usage voice_calls) on each
-- terminal-status poll, and `completion_polled_at` when it was last polled.
-- Additive + nullable — no default, no backfill; both stay null until a run
-- finishes dialing. The capture slice reads `completed_call_count`.
ALTER TABLE "outreach_robocall" ADD COLUMN "completed_call_count" INTEGER,
ADD COLUMN "completion_polled_at" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "TrackerTaskSkipReason" AS ENUM ('later', 'notForMe');

-- AlterTable
ALTER TABLE "campaign_tracker_tasks" ADD COLUMN     "skip_reason" "TrackerTaskSkipReason",
ADD COLUMN     "skipped_at" TIMESTAMP(3),
ADD COLUMN     "snoozed_until" TIMESTAMP(3);

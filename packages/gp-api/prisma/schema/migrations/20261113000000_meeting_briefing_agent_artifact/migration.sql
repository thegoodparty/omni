-- AlterTable
ALTER TABLE "meeting_briefing" ALTER COLUMN "experiment_run_id" DROP NOT NULL,
ALTER COLUMN "artifact_bucket" DROP NOT NULL,
ALTER COLUMN "artifact_key" DROP NOT NULL;

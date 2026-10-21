-- AlterEnum
ALTER TYPE "ConstituentFeedbackCaptureMethod" ADD VALUE 'dictation_offline';

-- AlterTable
ALTER TABLE "constituent_feedback" ADD COLUMN     "transcription_job_name" TEXT;

-- CreateIndex
CREATE INDEX "constituent_feedback_extraction_status_idx" ON "constituent_feedback"("extraction_status");

-- AlterTable
-- The S3 ETag of the audio bytes that passed compliance, so the verdict is
-- bound to the exact recording and a re-upload to the same presigned key cannot
-- ride a prior pass. Recorded on the verdict at check time and frozen onto the
-- draft at create; the staging step re-verifies it before dialing.
ALTER TABLE "robocall_compliance_result" ADD COLUMN "audio_etag" TEXT;
ALTER TABLE "outreach_robocall" ADD COLUMN "compliance_audio_etag" TEXT;

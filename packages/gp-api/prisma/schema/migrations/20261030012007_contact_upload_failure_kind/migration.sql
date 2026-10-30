-- CreateEnum
CREATE TYPE "ContactUploadFailureKind" AS ENUM ('file', 'transient');

-- AlterTable
ALTER TABLE "contact_upload" ADD COLUMN     "failure_kind" "ContactUploadFailureKind";

UPDATE "contact_upload"
SET "failure_kind" = CASE
  WHEN "failure_reason" IN (
    'This upload didn''t finish. Try again.',
    'We couldn''t start this upload. Try again.'
  ) THEN 'transient'::"ContactUploadFailureKind"
  ELSE 'file'::"ContactUploadFailureKind"
END
WHERE "status" = 'failed';

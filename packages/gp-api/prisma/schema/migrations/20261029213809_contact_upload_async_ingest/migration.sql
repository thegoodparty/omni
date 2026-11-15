-- AlterEnum
ALTER TYPE "ContactUploadStatus" ADD VALUE 'awaiting_file';

-- AlterTable
ALTER TABLE "contact_upload" ADD COLUMN "ingested_at" TIMESTAMP(3),
ALTER COLUMN "row_count" DROP NOT NULL;

UPDATE "contact_upload" SET "ingested_at" = "created_at";

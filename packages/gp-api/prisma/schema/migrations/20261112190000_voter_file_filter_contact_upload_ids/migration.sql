-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "contact_upload_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

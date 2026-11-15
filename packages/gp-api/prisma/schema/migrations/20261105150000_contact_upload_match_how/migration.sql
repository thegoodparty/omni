-- CreateEnum
CREATE TYPE "ContactUploadFirstNameMatch" AS ENUM ('exact', 'alias', 'prefix', 'typo');

-- CreateEnum
CREATE TYPE "ContactUploadResolution" AS ENUM ('candidate', 'search', 'suggestion', 'new_person', 'skip');

-- AlterTable
ALTER TABLE "contact_upload_match" ADD COLUMN     "first_name_match" "ContactUploadFirstNameMatch",
ADD COLUMN     "resolution" "ContactUploadResolution";

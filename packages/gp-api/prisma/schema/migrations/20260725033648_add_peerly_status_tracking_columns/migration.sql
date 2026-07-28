-- AlterTable
ALTER TABLE "tcr_compliance" ADD COLUMN     "peerly_cv_status" TEXT,
ADD COLUMN     "peerly_cv_status_changed_at" TIMESTAMP(3),
ADD COLUMN     "peerly_profile_status" TEXT,
ADD COLUMN     "peerly_profile_status_changed_at" TIMESTAMP(3);

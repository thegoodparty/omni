-- AlterTable
ALTER TABLE "tcr_compliance" ADD COLUMN     "cv_validation_failed_at" TIMESTAMP(3),
ADD COLUMN     "cv_validation_failure_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "cv_validation_overridden_at" TIMESTAMP(3);

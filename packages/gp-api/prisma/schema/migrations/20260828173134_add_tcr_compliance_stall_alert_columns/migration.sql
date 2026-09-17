-- AlterTable
ALTER TABLE "tcr_compliance" ADD COLUMN     "cv_never_reached_alerted_at" TIMESTAMP(3),
ADD COLUMN     "profile_stalled_alerted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tcr_compliance" ADD COLUMN     "cv_in_review_escalated_at" TIMESTAMP(3),
ADD COLUMN     "finalize_stalled_escalated_at" TIMESTAMP(3);

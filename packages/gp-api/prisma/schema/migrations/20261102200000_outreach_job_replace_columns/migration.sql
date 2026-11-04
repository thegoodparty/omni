-- AlterTable
ALTER TABLE "outreach" ADD COLUMN     "job_replace_claimed_at" TIMESTAMP(3),
ADD COLUMN     "job_replace_reason" TEXT,
ADD COLUMN     "job_replaced_at" TIMESTAMP(3),
ADD COLUMN     "job_replaced_by" TEXT,
ADD COLUMN     "previous_job_id" TEXT;

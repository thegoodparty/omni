-- AlterTable
ALTER TABLE "ordinance" ADD COLUMN     "quality_run_status" TEXT,
ADD COLUMN     "quality_run_started_at" TIMESTAMP(3),
ADD COLUMN     "quality_run_error" TEXT;

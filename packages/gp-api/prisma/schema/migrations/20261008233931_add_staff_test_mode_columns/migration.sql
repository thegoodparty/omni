-- AlterTable
ALTER TABLE "organization" ADD COLUMN "test_mode_created_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tcr_compliance" ADD COLUMN "internal_testing_at" TIMESTAMP(3);

-- Backfill: rows approved for internal testing before this column existed
UPDATE "tcr_compliance"
SET "internal_testing_at" = "internal_testing_approved_at"
WHERE "internal_testing_approved_at" IS NOT NULL;

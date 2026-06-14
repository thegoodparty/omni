-- DropIndex
DROP INDEX "elected_office_user_id_key";

-- AlterTable
ALTER TABLE "elected_office" ADD COLUMN     "elected_date" DATE,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "term_end_at" TIMESTAMP(3),
ADD COLUMN     "term_length_days" INTEGER,
ADD COLUMN     "term_start_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "elected_office_user_id_idx" ON "elected_office"("user_id");

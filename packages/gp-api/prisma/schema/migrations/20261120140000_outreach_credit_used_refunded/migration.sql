-- AlterTable
ALTER TABLE "outreach" ADD COLUMN     "credit_refunded_at" TIMESTAMP(3),
ADD COLUMN     "credit_used_cents" INTEGER NOT NULL DEFAULT 0;

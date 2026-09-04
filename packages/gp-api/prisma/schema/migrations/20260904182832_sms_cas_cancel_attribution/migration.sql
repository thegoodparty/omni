-- AlterTable
ALTER TABLE "outreach" ADD COLUMN     "canceled_at" TIMESTAMP(3),
ADD COLUMN     "canceled_by" TEXT,
ADD COLUMN     "canceled_by_admin" BOOLEAN NOT NULL DEFAULT false;

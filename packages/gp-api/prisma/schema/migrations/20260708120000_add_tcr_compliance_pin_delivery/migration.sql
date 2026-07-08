-- AlterTable
ALTER TABLE "tcr_compliance" ADD COLUMN     "pin_delivery_destination" TEXT,
ADD COLUMN     "pin_delivery_method" TEXT,
ADD COLUMN     "pin_sent_detected_at" TIMESTAMP(3);

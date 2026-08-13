-- AlterTable
ALTER TABLE "user" ADD COLUMN     "sms_consent_at" TIMESTAMP(3),
ADD COLUMN     "sms_consent_source" TEXT,
ADD COLUMN     "sms_opted_out_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "magic_link" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "sms_sent_at" TIMESTAMP(3),
ADD COLUMN     "sms_message_id" TEXT;

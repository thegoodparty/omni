-- AlterTable
ALTER TABLE "contact_interaction_phone_banking" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "contact_interaction_phone_banking" ALTER COLUMN "updated_at" DROP DEFAULT;

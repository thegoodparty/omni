-- AlterTable
ALTER TABLE "contact_interaction_robocall" ADD COLUMN     "manual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT,
ALTER COLUMN "outreach_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "contact_interaction_text" ADD COLUMN     "manual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT,
ALTER COLUMN "outreach_id" DROP NOT NULL;

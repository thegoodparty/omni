-- AlterEnum
ALTER TYPE "OutreachStatus" ADD VALUE 'pending_payment';

-- AlterTable
ALTER TABLE "outreach" ADD COLUMN     "billable_text_count" INTEGER,
ADD COLUMN     "campaign_plan_due_date" TEXT,
ADD COLUMN     "text_count" INTEGER;

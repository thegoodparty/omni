-- AlterEnum
ALTER TYPE "OutreachStatus" ADD VALUE 'draft';

-- AlterEnum
ALTER TYPE "RobocallSettleState" ADD VALUE 'draft';

-- AlterTable
ALTER TABLE "outreach_robocall" ALTER COLUMN "billable_count" DROP NOT NULL,
ALTER COLUMN "amount_in_cents" DROP NOT NULL;

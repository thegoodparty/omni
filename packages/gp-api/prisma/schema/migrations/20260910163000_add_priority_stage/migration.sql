-- CreateEnum
CREATE TYPE "PriorityStage" AS ENUM ('exploring', 'gathering_input', 'shaping', 'ready_for_vote');

-- AlterTable
ALTER TABLE "priority" ADD COLUMN     "stage" "PriorityStage";

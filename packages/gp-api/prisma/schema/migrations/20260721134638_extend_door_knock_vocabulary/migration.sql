-- CreateEnum
CREATE TYPE "WillVoteAnswer" AS ENUM ('yes', 'no', 'unsure');

-- AlterEnum
ALTER TYPE "DoorKnockOutcome" ADD VALUE 'inaccessible';
ALTER TYPE "DoorKnockOutcome" ADD VALUE 'not_a_voter';

-- AlterTable
ALTER TABLE "contact_interaction_door_knock" ADD COLUMN     "will_vote" "WillVoteAnswer";

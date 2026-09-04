-- CreateEnum
CREATE TYPE "FollowUpAnswer" AS ENUM ('yes', 'no');

-- AlterTable
ALTER TABLE "contact_interaction_door_knock" ADD COLUMN     "follow_up" "FollowUpAnswer";

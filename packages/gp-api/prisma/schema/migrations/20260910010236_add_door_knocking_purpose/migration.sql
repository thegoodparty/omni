-- CreateEnum
CREATE TYPE "DoorKnockingPurpose" AS ENUM ('introduce_myself', 'persuade_voters', 'event_invite', 'early_voting', 'election_day_turnout', 'custom', 'explain_decision', 'community_input', 'share_resource');

-- AlterTable
ALTER TABLE "door_knocking_turf" ADD COLUMN     "purpose" "DoorKnockingPurpose";

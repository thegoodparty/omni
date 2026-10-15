-- Serve's door and call flows close by asking a reached constituent to join
-- the office's civic panel. The answer is history for that one knock or call,
-- so it lives on the interaction row next to follow_up and reuses its yes/no
-- enum; the standing membership is the civic_panel contact status.

-- AlterTable
ALTER TABLE "contact_interaction_door_knock" ADD COLUMN     "join_civic_panel" "FollowUpAnswer";

-- AlterTable
ALTER TABLE "contact_interaction_phone_banking" ADD COLUMN     "join_civic_panel" "FollowUpAnswer";

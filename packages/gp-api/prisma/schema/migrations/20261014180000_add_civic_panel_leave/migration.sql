-- A resident can leave the office's civic panel without opting out of its
-- texts. A text sent to panel members only carries a fixed "Reply LEAVE"
-- sentence instead of the JOIN ask, and a door or call on a panel-only list
-- asks whether they want to stay on rather than whether they want to join.
--
-- `offers_civic_panel_leave` is set at create from the stored message, the
-- twin of `asks_to_join_civic_panel`. `stay_on_civic_panel` is what one knock
-- or call heard; the standing membership is the civic_panel contact status.
--
-- Additive only: a defaulted column and two nullable ones.

-- AlterTable
ALTER TABLE "outreach" ADD COLUMN "offers_civic_panel_leave" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "contact_interaction_door_knock" ADD COLUMN     "stay_on_civic_panel" "FollowUpAnswer";

-- AlterTable
ALTER TABLE "contact_interaction_phone_banking" ADD COLUMN     "stay_on_civic_panel" "FollowUpAnswer";

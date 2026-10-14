-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "civic_panel_joined_by_door" BOOLEAN DEFAULT false,
ADD COLUMN     "civic_panel_joined_by_hand" BOOLEAN DEFAULT false,
ADD COLUMN     "civic_panel_joined_by_phone" BOOLEAN DEFAULT false,
ADD COLUMN     "civic_panel_joined_by_text" BOOLEAN DEFAULT false,
ADD COLUMN     "civic_panel_joined_from" TEXT,
ADD COLUMN     "civic_panel_joined_to" TEXT,
ADD COLUMN     "civic_panel_left" BOOLEAN DEFAULT false,
ADD COLUMN     "civic_panel_never_invited" BOOLEAN DEFAULT false,
ADD COLUMN     "last_reached_from" TEXT,
ADD COLUMN     "last_reached_to" TEXT;

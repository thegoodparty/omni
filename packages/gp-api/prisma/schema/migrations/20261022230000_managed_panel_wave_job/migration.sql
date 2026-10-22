-- AlterEnum
ALTER TYPE "ManagedCivicPanelStatus" ADD VALUE 'exhausted';

-- AlterTable
ALTER TABLE "managed_panel_wave" ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "joined_members" INTEGER;

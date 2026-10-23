-- DropForeignKey
ALTER TABLE "civic_panel_joiner" DROP CONSTRAINT "civic_panel_joiner_organization_slug_fkey";

-- DropIndex
DROP INDEX "managed_civic_panel_share_code_key";

-- AlterTable
ALTER TABLE "managed_civic_panel" DROP COLUMN "share_code";

-- DropTable
DROP TABLE "civic_panel_joiner";

-- DropEnum
DROP TYPE "CivicPanelJoinSource";

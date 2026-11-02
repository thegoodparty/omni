-- The do-it-yourself build plan's home cards: the office's build card and
-- the plan's step cards. Nothing makes or reads them now.
DELETE FROM "dashboard_card"
WHERE "type"::text = 'civic_panel'
  AND ("source_external_id" LIKE 'build:%'
    OR "source_external_id" LIKE 'panel-step:%');

-- DropForeignKey
ALTER TABLE "civic_panel_build_step" DROP CONSTRAINT "civic_panel_build_step_door_knocking_turf_id_fkey";

-- DropForeignKey
ALTER TABLE "civic_panel_build_step" DROP CONSTRAINT "civic_panel_build_step_outreach_id_fkey";

-- DropForeignKey
ALTER TABLE "civic_panel_build_step" DROP CONSTRAINT "civic_panel_build_step_phone_banking_list_id_fkey";

-- DropForeignKey
ALTER TABLE "civic_panel_build_step" DROP CONSTRAINT "civic_panel_build_step_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "civic_panel_build_step" DROP CONSTRAINT "civic_panel_build_step_voter_file_filter_id_fkey";

-- DropForeignKey
ALTER TABLE "civic_panel_build_plan" DROP CONSTRAINT "civic_panel_build_plan_elected_office_id_fkey";

-- DropForeignKey
ALTER TABLE "civic_panel_build_plan" DROP CONSTRAINT "civic_panel_build_plan_organization_slug_fkey";

-- DropTable
DROP TABLE "civic_panel_build_step";

-- DropTable
DROP TABLE "civic_panel_build_plan";

-- DropEnum
DROP TYPE "CivicPanelBuildChannel";

-- DropEnum
DROP TYPE "CivicPanelBuildPlanStatus";

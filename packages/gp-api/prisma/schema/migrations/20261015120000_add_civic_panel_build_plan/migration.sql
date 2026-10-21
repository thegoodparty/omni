-- CreateEnum
CREATE TYPE "CivicPanelBuildPlanStatus" AS ENUM ('active', 'completed', 'exhausted');

-- CreateEnum
CREATE TYPE "CivicPanelBuildChannel" AS ENUM ('text', 'phone_banking', 'door_knocking');

-- CreateTable
CREATE TABLE "civic_panel_build_plan" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "elected_office_id" TEXT NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "goal_members" INTEGER NOT NULL,
    "hours_per_month" INTEGER NOT NULL,
    "status" "CivicPanelBuildPlanStatus" NOT NULL DEFAULT 'active',
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "civic_panel_build_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "civic_panel_build_step" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "plan_id" TEXT NOT NULL,
    "wave" INTEGER NOT NULL,
    "channel" "CivicPanelBuildChannel" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 1,
    "target_size" INTEGER NOT NULL,
    "voter_file_filter_id" INTEGER,
    "prepared_at" TIMESTAMP(3),
    "outreach_id" INTEGER,
    "phone_banking_list_id" INTEGER,
    "door_knocking_turf_id" INTEGER,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "expected_replies_by" TIMESTAMP(3),

    CONSTRAINT "civic_panel_build_step_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "civic_panel_build_plan_elected_office_id_idx" ON "civic_panel_build_plan"("elected_office_id");

-- CreateIndex
CREATE INDEX "civic_panel_build_plan_organization_slug_idx" ON "civic_panel_build_plan"("organization_slug");

-- CreateIndex
CREATE UNIQUE INDEX "civic_panel_build_step_voter_file_filter_id_key" ON "civic_panel_build_step"("voter_file_filter_id");

-- CreateIndex
CREATE INDEX "civic_panel_build_step_outreach_id_idx" ON "civic_panel_build_step"("outreach_id");

-- CreateIndex
CREATE INDEX "civic_panel_build_step_phone_banking_list_id_idx" ON "civic_panel_build_step"("phone_banking_list_id");

-- CreateIndex
CREATE INDEX "civic_panel_build_step_door_knocking_turf_id_idx" ON "civic_panel_build_step"("door_knocking_turf_id");

-- CreateIndex
CREATE UNIQUE INDEX "civic_panel_build_step_plan_id_wave_channel_position_key" ON "civic_panel_build_step"("plan_id", "wave", "channel", "position");

-- AddForeignKey
ALTER TABLE "civic_panel_build_plan" ADD CONSTRAINT "civic_panel_build_plan_elected_office_id_fkey" FOREIGN KEY ("elected_office_id") REFERENCES "elected_office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "civic_panel_build_plan" ADD CONSTRAINT "civic_panel_build_plan_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "civic_panel_build_step" ADD CONSTRAINT "civic_panel_build_step_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "civic_panel_build_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "civic_panel_build_step" ADD CONSTRAINT "civic_panel_build_step_voter_file_filter_id_fkey" FOREIGN KEY ("voter_file_filter_id") REFERENCES "voter_file_filter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "civic_panel_build_step" ADD CONSTRAINT "civic_panel_build_step_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "civic_panel_build_step" ADD CONSTRAINT "civic_panel_build_step_phone_banking_list_id_fkey" FOREIGN KEY ("phone_banking_list_id") REFERENCES "phone_banking_list"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "civic_panel_build_step" ADD CONSTRAINT "civic_panel_build_step_door_knocking_turf_id_fkey" FOREIGN KEY ("door_knocking_turf_id") REFERENCES "door_knocking_turf"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One active plan per office. Prisma cannot declare a partial unique index,
-- so it lives here; a second create racing the first trips it.
CREATE UNIQUE INDEX "civic_panel_build_plan_one_active_per_office"
  ON "civic_panel_build_plan" ("elected_office_id")
  WHERE "status" = 'active';

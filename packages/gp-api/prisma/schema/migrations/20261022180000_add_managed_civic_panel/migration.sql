-- CreateEnum
CREATE TYPE "ManagedCivicPanelStatus" AS ENUM ('building', 'ready', 'paused', 'stopped');

-- CreateTable
CREATE TABLE "managed_civic_panel" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "status" "ManagedCivicPanelStatus" NOT NULL DEFAULT 'building',
    "invite_message" TEXT NOT NULL,
    "consent_version" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL,
    "approved_by_user_id" INTEGER,
    "goal_members" INTEGER NOT NULL,
    "free_text_cap" INTEGER NOT NULL DEFAULT 15000,
    "free_texts_used" INTEGER NOT NULL DEFAULT 0,
    "ready_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "stopped_at" TIMESTAMP(3),

    CONSTRAINT "managed_civic_panel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "managed_panel_wave" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "wave" INTEGER NOT NULL,
    "voter_file_filter_id" INTEGER,
    "outreach_id" INTEGER,
    "steered_toward" TEXT,
    "sent_at" TIMESTAMP(3),
    "reply_window_ends_at" TIMESTAMP(3),

    CONSTRAINT "managed_panel_wave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "managed_civic_panel_organization_slug_key" ON "managed_civic_panel"("organization_slug");

-- CreateIndex
CREATE UNIQUE INDEX "managed_panel_wave_outreach_id_key" ON "managed_panel_wave"("outreach_id");

-- CreateIndex
CREATE INDEX "managed_panel_wave_voter_file_filter_id_idx" ON "managed_panel_wave"("voter_file_filter_id");

-- CreateIndex
CREATE UNIQUE INDEX "managed_panel_wave_enrollment_id_wave_key" ON "managed_panel_wave"("enrollment_id", "wave");

-- AddForeignKey
ALTER TABLE "managed_civic_panel" ADD CONSTRAINT "managed_civic_panel_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "managed_civic_panel" ADD CONSTRAINT "managed_civic_panel_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "managed_panel_wave" ADD CONSTRAINT "managed_panel_wave_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "managed_civic_panel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "managed_panel_wave" ADD CONSTRAINT "managed_panel_wave_voter_file_filter_id_fkey" FOREIGN KEY ("voter_file_filter_id") REFERENCES "voter_file_filter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "managed_panel_wave" ADD CONSTRAINT "managed_panel_wave_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE SET NULL ON UPDATE CASCADE;


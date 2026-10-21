-- CreateEnum
CREATE TYPE "SynthesisScope" AS ENUM ('effort', 'organization');

-- CreateEnum
CREATE TYPE "SynthesisRunStatus" AS ENUM ('running', 'completed', 'failed', 'superseded');

-- CreateEnum
CREATE TYPE "IssueTagStatus" AS ENUM ('proposed', 'accepted', 'retired');

-- CreateEnum
CREATE TYPE "IssueTagSource" AS ENUM ('seed', 'synthesis', 'human');

-- AlterTable
ALTER TABLE "constituent_feedback" ADD COLUMN     "outreach_id" INTEGER;

-- AlterTable
ALTER TABLE "contact_interaction_door_knock" ADD COLUMN     "outreach_id" INTEGER;

-- CreateTable
CREATE TABLE "feedback_synthesis_run" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "organization_slug" TEXT NOT NULL,
    "scope" "SynthesisScope" NOT NULL,
    "outreach_id" INTEGER,
    "status" "SynthesisRunStatus" NOT NULL DEFAULT 'running',
    "active_key" TEXT,
    "conversations" INTEGER NOT NULL,
    "memos" INTEGER NOT NULL,
    "confirmed" INTEGER NOT NULL,
    "engine" TEXT NOT NULL,
    "error" TEXT,
    "requested_by_user_id" INTEGER,

    CONSTRAINT "feedback_synthesis_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_theme" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "tag_id" TEXT,

    CONSTRAINT "feedback_theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_theme_member" (
    "theme_id" TEXT NOT NULL,
    "feedback_id" TEXT NOT NULL,

    CONSTRAINT "feedback_theme_member_pkey" PRIMARY KEY ("theme_id","feedback_id")
);

-- CreateTable
CREATE TABLE "issue_tag" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "status" "IssueTagStatus" NOT NULL DEFAULT 'proposed',
    "source" "IssueTagSource" NOT NULL,
    "declared_top_issue_id" INTEGER,
    "proposed_by_run_id" TEXT,
    "merged_into_id" TEXT,

    CONSTRAINT "issue_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "constituent_feedback_tag" (
    "feedback_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "constituent_feedback_tag_pkey" PRIMARY KEY ("feedback_id","tag_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_synthesis_run_active_key_key" ON "feedback_synthesis_run"("active_key");

-- CreateIndex
CREATE INDEX "feedback_synthesis_run_organization_slug_outreach_id_create_idx" ON "feedback_synthesis_run"("organization_slug", "outreach_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_synthesis_run_organization_slug_scope_created_at_idx" ON "feedback_synthesis_run"("organization_slug", "scope", "created_at");

-- CreateIndex
CREATE INDEX "feedback_theme_run_id_rank_idx" ON "feedback_theme"("run_id", "rank");

-- CreateIndex
CREATE INDEX "issue_tag_organization_slug_status_idx" ON "issue_tag"("organization_slug", "status");

-- CreateIndex
CREATE UNIQUE INDEX "issue_tag_organization_slug_normalized_name_key" ON "issue_tag"("organization_slug", "normalized_name");

-- CreateIndex
CREATE INDEX "constituent_feedback_tag_tag_id_idx" ON "constituent_feedback_tag"("tag_id");

-- CreateIndex
CREATE INDEX "constituent_feedback_organization_slug_outreach_id_idx" ON "constituent_feedback"("organization_slug", "outreach_id");

-- CreateIndex
CREATE INDEX "contact_interaction_door_knock_organization_slug_outreach_i_idx" ON "contact_interaction_door_knock"("organization_slug", "outreach_id");

-- AddForeignKey
ALTER TABLE "constituent_feedback" ADD CONSTRAINT "constituent_feedback_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_interaction_door_knock" ADD CONSTRAINT "contact_interaction_door_knock_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_synthesis_run" ADD CONSTRAINT "feedback_synthesis_run_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_synthesis_run" ADD CONSTRAINT "feedback_synthesis_run_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_synthesis_run" ADD CONSTRAINT "feedback_synthesis_run_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_theme" ADD CONSTRAINT "feedback_theme_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "feedback_synthesis_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_theme" ADD CONSTRAINT "feedback_theme_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "issue_tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_theme_member" ADD CONSTRAINT "feedback_theme_member_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "feedback_theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_theme_member" ADD CONSTRAINT "feedback_theme_member_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "constituent_feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_tag" ADD CONSTRAINT "issue_tag_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_tag" ADD CONSTRAINT "issue_tag_declared_top_issue_id_fkey" FOREIGN KEY ("declared_top_issue_id") REFERENCES "top_issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_tag" ADD CONSTRAINT "issue_tag_proposed_by_run_id_fkey" FOREIGN KEY ("proposed_by_run_id") REFERENCES "feedback_synthesis_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_tag" ADD CONSTRAINT "issue_tag_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "issue_tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constituent_feedback_tag" ADD CONSTRAINT "constituent_feedback_tag_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "constituent_feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constituent_feedback_tag" ADD CONSTRAINT "constituent_feedback_tag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "issue_tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constituent_feedback_tag" ADD CONSTRAINT "constituent_feedback_tag_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "feedback_synthesis_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

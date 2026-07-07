-- CreateEnum
CREATE TYPE "OrdinanceStatus" AS ENUM ('in_progress', 'draft', 'in_review', 'proposed', 'passed', 'repealed');

-- CreateEnum
CREATE TYPE "OrdinanceSeedType" AS ENUM ('issue', 'new');

-- CreateTable
CREATE TABLE "ordinance" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "elected_office_id" TEXT NOT NULL,
    "status" "OrdinanceStatus" NOT NULL DEFAULT 'in_progress',
    "seed_type" "OrdinanceSeedType" NOT NULL,
    "issue_slug" TEXT,
    "source_link" TEXT,
    "goal_text" TEXT,
    "existing_law" JSONB,
    "clarify" JSONB,
    "clarify_answers" JSONB,
    "authority" JSONB,
    "comparables" JSONB,
    "draft_sources" JSONB,
    "quality_report" JSONB,
    "research" JSONB,
    "scratchpad" JSONB,
    "draft_title" TEXT,
    "draft_body" TEXT,
    "last_viewed_step" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ordinance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ordinance_slug_key" ON "ordinance"("slug");

-- CreateIndex
CREATE INDEX "ordinance_elected_office_id_deleted_at_updated_at_idx" ON "ordinance"("elected_office_id", "deleted_at", "updated_at");

-- AddForeignKey
ALTER TABLE "ordinance" ADD CONSTRAINT "ordinance_elected_office_id_fkey" FOREIGN KEY ("elected_office_id") REFERENCES "elected_office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

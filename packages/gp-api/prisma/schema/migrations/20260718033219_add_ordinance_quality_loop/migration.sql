-- CreateEnum
CREATE TYPE "OrdinanceQualityLoopStatus" AS ENUM ('running', 'converged', 'stopped_max_iterations', 'stopped_not_improving', 'superseded_by_edit', 'cancelled', 'failed');

-- AlterTable
ALTER TABLE "ordinance" ADD COLUMN     "quality_loop_iteration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quality_loop_run_id" TEXT,
ADD COLUMN     "quality_loop_status" "OrdinanceQualityLoopStatus",
ADD COLUMN     "quality_loop_updated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ordinance_quality_iteration" (
    "id" TEXT NOT NULL,
    "ordinance_id" TEXT NOT NULL,
    "loop_run_id" TEXT NOT NULL,
    "iteration" INTEGER NOT NULL,
    "input_hash" TEXT NOT NULL,
    "qc_attempts" INTEGER NOT NULL DEFAULT 1,
    "draft_title" TEXT NOT NULL,
    "draft_body" TEXT NOT NULL,
    "report" JSONB,
    "model" TEXT,
    "tokens" INTEGER,
    "revised_title" TEXT,
    "revised_body" TEXT,
    "revised_input_hash" TEXT,
    "revision_notes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ordinance_quality_iteration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ordinance_quality_iteration_ordinance_id_loop_run_id_iterat_key" ON "ordinance_quality_iteration"("ordinance_id", "loop_run_id", "iteration");

-- AddForeignKey
ALTER TABLE "ordinance_quality_iteration" ADD CONSTRAINT "ordinance_quality_iteration_ordinance_id_fkey" FOREIGN KEY ("ordinance_id") REFERENCES "ordinance"("id") ON DELETE CASCADE ON UPDATE CASCADE;


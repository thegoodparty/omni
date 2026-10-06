-- Backfilled through a temporary default so a database that already holds
-- runs can take the column; Prisma maintains it from here on.
ALTER TABLE "feedback_synthesis_run" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "feedback_synthesis_run" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "feedback_theme" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

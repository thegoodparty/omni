-- AlterTable
ALTER TABLE "race_opponent_standout_action" ADD COLUMN     "haystaq_count_ge50" INTEGER,
ADD COLUMN     "haystaq_count_ge70" INTEGER,
ADD COLUMN     "haystaq_pct_ge50" DOUBLE PRECISION,
ADD COLUMN     "haystaq_pct_ge70" DOUBLE PRECISION,
ADD COLUMN     "haystaq_total_active" INTEGER,
ADD COLUMN     "hs_column" TEXT,
ADD COLUMN     "position_dir" TEXT,
ADD COLUMN     "position_phrase" TEXT;

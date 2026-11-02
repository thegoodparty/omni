-- CreateEnum
CREATE TYPE "ElectedOfficeWinSource" AS ENUM ('self_reported', 'staff', 'ddhq');

-- AlterTable
ALTER TABLE "elected_office" ADD COLUMN     "win_source" "ElectedOfficeWinSource";

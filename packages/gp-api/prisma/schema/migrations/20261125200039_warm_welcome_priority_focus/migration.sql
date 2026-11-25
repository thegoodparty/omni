-- CreateEnum
CREATE TYPE "ResidentInterest" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "FirstWinHorizon" AS ENUM ('weeks', 'months', 'year_or_more');

-- CreateEnum
CREATE TYPE "FocusFactSource" AS ENUM ('local_sources', 'estimate', 'default');

-- CreateEnum
CREATE TYPE "PriorityFocusOptionKind" AS ENUM ('ran_on', 'community');

-- AlterTable
ALTER TABLE "community_issue" ADD COLUMN     "first_win" "FirstWinHorizon",
ADD COLUMN     "first_win_source" "FocusFactSource",
ADD COLUMN     "recap_line" TEXT;

-- AlterTable
ALTER TABLE "priority" ADD COLUMN     "first_win" "FirstWinHorizon",
ADD COLUMN     "first_win_source" "FocusFactSource",
ADD COLUMN     "focused_at" TIMESTAMP(3),
ADD COLUMN     "recap_line" TEXT,
ADD COLUMN     "resident_interest" "ResidentInterest",
ADD COLUMN     "resident_interest_source" "FocusFactSource";

-- CreateTable
CREATE TABLE "priority_focus_choice" (
    "id" TEXT NOT NULL,
    "elected_office_id" TEXT NOT NULL,
    "priority_id" TEXT NOT NULL,
    "priority_activated" BOOLEAN NOT NULL,
    "picked_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "priority_focus_choice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "priority_focus_option" (
    "id" TEXT NOT NULL,
    "choice_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "PriorityFocusOptionKind" NOT NULL,
    "title" TEXT NOT NULL,
    "resident_interest" "ResidentInterest" NOT NULL,
    "resident_interest_source" "FocusFactSource" NOT NULL,
    "first_win" "FirstWinHorizon" NOT NULL,
    "first_win_source" "FocusFactSource" NOT NULL,
    "picked" BOOLEAN NOT NULL,

    CONSTRAINT "priority_focus_option_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "priority_focus_choice_elected_office_id_key" ON "priority_focus_choice"("elected_office_id");

-- CreateIndex
CREATE UNIQUE INDEX "priority_focus_option_choice_id_key_key" ON "priority_focus_option"("choice_id", "key");

-- AddForeignKey
ALTER TABLE "priority_focus_choice" ADD CONSTRAINT "priority_focus_choice_elected_office_id_fkey" FOREIGN KEY ("elected_office_id") REFERENCES "elected_office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_focus_choice" ADD CONSTRAINT "priority_focus_choice_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "priority"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_focus_option" ADD CONSTRAINT "priority_focus_option_choice_id_fkey" FOREIGN KEY ("choice_id") REFERENCES "priority_focus_choice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

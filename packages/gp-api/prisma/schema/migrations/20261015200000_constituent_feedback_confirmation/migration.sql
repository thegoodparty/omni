-- CreateEnum
CREATE TYPE "ConstituentFeedbackConfirmation" AS ENUM ('reviewed', 'skipped', 'automatic');

-- AlterTable
ALTER TABLE "constituent_feedback" ADD COLUMN     "confirmation" "ConstituentFeedbackConfirmation",
ADD COLUMN     "transcription_attempts" INTEGER NOT NULL DEFAULT 0;

-- Every memo confirmed before this column existed was confirmed by a person,
-- on the confirm card or the review list.
UPDATE "constituent_feedback" SET "confirmation" = 'reviewed' WHERE "confirmed_at" IS NOT NULL;

-- CreateTable
CREATE TABLE "constituent_feedback_unreviewed_issue" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feedback_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "issue_label" TEXT NOT NULL,
    "stance" TEXT,
    "desired_outcome" TEXT,

    CONSTRAINT "constituent_feedback_unreviewed_issue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "constituent_feedback_unreviewed_issue_feedback_id_position_key" ON "constituent_feedback_unreviewed_issue"("feedback_id", "position");

-- AddForeignKey
ALTER TABLE "constituent_feedback_unreviewed_issue" ADD CONSTRAINT "constituent_feedback_unreviewed_issue_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "constituent_feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

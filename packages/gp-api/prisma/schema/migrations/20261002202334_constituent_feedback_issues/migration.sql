-- One memo can now carry several issues, so the per-issue columns move off
-- constituent_feedback into a child table. Every existing memo that holds
-- any of the six values becomes one issue at position 0 before the columns
-- are dropped.

-- CreateTable
CREATE TABLE "constituent_feedback_issue" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feedback_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "issue_label" TEXT NOT NULL,
    "stance" "ConstituentFeedbackStance",
    "desired_outcome" TEXT,
    "proposed_issue_label" TEXT,
    "proposed_stance" TEXT,
    "proposed_desired_outcome" TEXT,

    CONSTRAINT "constituent_feedback_issue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "constituent_feedback_issue_feedback_id_position_key" ON "constituent_feedback_issue"("feedback_id", "position");

-- AddForeignKey
ALTER TABLE "constituent_feedback_issue" ADD CONSTRAINT "constituent_feedback_issue_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "constituent_feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy. A label is now required, and a memo confirmed with its label
-- cleared gets an empty one rather than the model's: the proposal was
-- rejected, and copying it into the confirmed column would put the model's
-- words in a human's mouth. The proposal itself survives in its own column.
INSERT INTO "constituent_feedback_issue" (
    "id",
    "created_at",
    "feedback_id",
    "position",
    "issue_label",
    "stance",
    "desired_outcome",
    "proposed_issue_label",
    "proposed_stance",
    "proposed_desired_outcome"
)
SELECT
    gen_random_uuid()::text,
    "created_at",
    "id",
    0,
    COALESCE("issue_label", ''),
    "stance",
    "desired_outcome",
    "proposed_issue_label",
    "proposed_stance",
    "proposed_desired_outcome"
FROM "constituent_feedback"
WHERE "issue_label" IS NOT NULL
   OR "stance" IS NOT NULL
   OR "desired_outcome" IS NOT NULL
   OR "proposed_issue_label" IS NOT NULL
   OR "proposed_stance" IS NOT NULL
   OR "proposed_desired_outcome" IS NOT NULL;

-- AlterTable
ALTER TABLE "constituent_feedback" DROP COLUMN "desired_outcome",
DROP COLUMN "issue_label",
DROP COLUMN "proposed_desired_outcome",
DROP COLUMN "proposed_issue_label",
DROP COLUMN "proposed_stance",
DROP COLUMN "stance";

-- AlterTable
ALTER TABLE "feedback_synthesis_run" ADD COLUMN     "issues_matched_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "feedback_theme_issue" (
    "theme_id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,

    CONSTRAINT "feedback_theme_issue_pkey" PRIMARY KEY ("theme_id","issue_id")
);

-- CreateIndex
CREATE INDEX "feedback_theme_issue_issue_id_idx" ON "feedback_theme_issue"("issue_id");

-- AddForeignKey
ALTER TABLE "feedback_theme_issue" ADD CONSTRAINT "feedback_theme_issue_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "feedback_theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_theme_issue" ADD CONSTRAINT "feedback_theme_issue_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "constituent_feedback_issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;


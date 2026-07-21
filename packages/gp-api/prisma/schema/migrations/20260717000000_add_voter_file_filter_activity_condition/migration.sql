-- CreateEnum
CREATE TYPE "SupportStatusRollup" AS ENUM ('supporter', 'non_supporter', 'unknown');

-- CreateEnum
CREATE TYPE "ActivityConditionAction" AS ENUM ('responded', 'no_response', 'opted_out', 'answered', 'not_home', 'refused_to_engage', 'support_yes', 'support_unsure', 'support_no', 'voicemail_left', 'no_answer');

-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "first_used_for_outreach_at" TIMESTAMP(3),
ADD COLUMN     "support_status" "SupportStatusRollup"[] DEFAULT ARRAY[]::"SupportStatusRollup"[];

-- CreateTable
CREATE TABLE "voter_file_filter_activity_condition" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voter_file_filter_id" INTEGER NOT NULL,
    "outreach_type" "OutreachType" NOT NULL,
    "outreach_id" INTEGER,
    "actions" "ActivityConditionAction"[] DEFAULT ARRAY[]::"ActivityConditionAction"[],

    CONSTRAINT "voter_file_filter_activity_condition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voter_file_filter_activity_condition_voter_file_filter_id_idx" ON "voter_file_filter_activity_condition"("voter_file_filter_id");

-- AddForeignKey
ALTER TABLE "voter_file_filter_activity_condition" ADD CONSTRAINT "voter_file_filter_activity_condition_voter_file_filter_id_fkey" FOREIGN KEY ("voter_file_filter_id") REFERENCES "voter_file_filter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter_file_filter_activity_condition" ADD CONSTRAINT "voter_file_filter_activity_condition_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "ConstituentFeedbackChannel" AS ENUM ('door_knock', 'phone_bank');

-- CreateEnum
CREATE TYPE "ConstituentFeedbackStance" AS ENUM ('supports', 'opposes', 'mixed', 'unclear');

-- CreateEnum
CREATE TYPE "ConstituentFeedbackCaptureMethod" AS ENUM ('dictation', 'typed');

-- CreateEnum
CREATE TYPE "ConstituentFeedbackExtractionStatus" AS ENUM ('pending', 'extracted', 'failed');

-- CreateTable
CREATE TABLE "constituent_feedback" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "actor_user_id" INTEGER NOT NULL,
    "channel" "ConstituentFeedbackChannel" NOT NULL,
    "door_knock_interaction_id" TEXT,
    "phone_banking_interaction_id" TEXT,
    "transcript" TEXT,
    "capture_method" "ConstituentFeedbackCaptureMethod" NOT NULL,
    "audio_key" TEXT,
    "issue_label" TEXT,
    "stance" "ConstituentFeedbackStance",
    "desired_outcome" TEXT,
    "extraction_status" "ConstituentFeedbackExtractionStatus" NOT NULL DEFAULT 'pending',
    "extraction_confidence" DOUBLE PRECISION,
    "extraction_model" TEXT,
    "proposed_issue_label" TEXT,
    "proposed_stance" TEXT,
    "proposed_desired_outcome" TEXT,
    "effort_question" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "client_key" TEXT NOT NULL,

    CONSTRAINT "constituent_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "constituent_feedback_door_knock_interaction_id_key" ON "constituent_feedback"("door_knock_interaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "constituent_feedback_phone_banking_interaction_id_key" ON "constituent_feedback"("phone_banking_interaction_id");

-- CreateIndex
CREATE INDEX "constituent_feedback_organization_slug_person_id_occurred_a_idx" ON "constituent_feedback"("organization_slug", "person_id", "occurred_at");

-- CreateIndex
CREATE INDEX "constituent_feedback_organization_slug_actor_user_id_idx" ON "constituent_feedback"("organization_slug", "actor_user_id");

-- CreateIndex
CREATE INDEX "constituent_feedback_organization_slug_extraction_status_idx" ON "constituent_feedback"("organization_slug", "extraction_status");

-- CreateIndex
CREATE UNIQUE INDEX "constituent_feedback_organization_slug_client_key_key" ON "constituent_feedback"("organization_slug", "client_key");

-- AddForeignKey
ALTER TABLE "constituent_feedback" ADD CONSTRAINT "constituent_feedback_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constituent_feedback" ADD CONSTRAINT "constituent_feedback_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constituent_feedback" ADD CONSTRAINT "constituent_feedback_door_knock_interaction_id_fkey" FOREIGN KEY ("door_knock_interaction_id") REFERENCES "contact_interaction_door_knock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constituent_feedback" ADD CONSTRAINT "constituent_feedback_phone_banking_interaction_id_fkey" FOREIGN KEY ("phone_banking_interaction_id") REFERENCES "contact_interaction_phone_banking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "SupportAnswer" AS ENUM ('supporter', 'unsure', 'non_supporter');

-- CreateEnum
CREATE TYPE "DoorKnockOutcome" AS ENUM ('answered', 'not_home', 'refused_to_engage');

-- AlterTable
ALTER TABLE "outreach" ADD COLUMN     "organization_slug" TEXT;

-- CreateTable
CREATE TABLE "contact_interaction_door_knock" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_slug" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "outcome" "DoorKnockOutcome" NOT NULL,
    "support_answer" "SupportAnswer",
    "note" TEXT,
    "source_id" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contact_interaction_door_knock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_interaction_robocall" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_slug" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "answered_at" TIMESTAMP(3),
    "voicemail_left_at" TIMESTAMP(3),
    "source_call_id" TEXT,

    CONSTRAINT "contact_interaction_robocall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_interaction_text" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_slug" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "responded_at" TIMESTAMP(3),
    "unsubscribed_at" TIMESTAMP(3),
    "opted_out_at" TIMESTAMP(3),
    "source_event_id" TEXT,

    CONSTRAINT "contact_interaction_text_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_note" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "contact_note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_interaction_door_knock_organization_slug_person_id__idx" ON "contact_interaction_door_knock"("organization_slug", "person_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_interaction_door_knock_organization_slug_source_id_key" ON "contact_interaction_door_knock"("organization_slug", "source_id");

-- CreateIndex
CREATE INDEX "contact_interaction_robocall_organization_slug_person_id_oc_idx" ON "contact_interaction_robocall"("organization_slug", "person_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_interaction_robocall_outreach_id_person_id_key" ON "contact_interaction_robocall"("outreach_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_interaction_robocall_organization_slug_source_call__key" ON "contact_interaction_robocall"("organization_slug", "source_call_id");

-- CreateIndex
CREATE INDEX "contact_interaction_text_organization_slug_person_id_occurr_idx" ON "contact_interaction_text"("organization_slug", "person_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_interaction_text_outreach_id_person_id_key" ON "contact_interaction_text"("outreach_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_interaction_text_organization_slug_source_event_id_key" ON "contact_interaction_text"("organization_slug", "source_event_id");

-- CreateIndex
CREATE INDEX "contact_note_organization_slug_person_id_created_at_idx" ON "contact_note"("organization_slug", "person_id", "created_at");

-- AddForeignKey
ALTER TABLE "contact_interaction_door_knock" ADD CONSTRAINT "contact_interaction_door_knock_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_interaction_robocall" ADD CONSTRAINT "contact_interaction_robocall_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_interaction_robocall" ADD CONSTRAINT "contact_interaction_robocall_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_interaction_text" ADD CONSTRAINT "contact_interaction_text_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_interaction_text" ADD CONSTRAINT "contact_interaction_text_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_note" ADD CONSTRAINT "contact_note_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE SET NULL ON UPDATE CASCADE;


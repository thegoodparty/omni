-- Generalize poll_individual_message so a per-person text message can belong
-- to a poll OR to a text outreach. This is the only table in the schema that
-- stores inbound SMS body text (the Win inbound sweep records timestamps on
-- contact_interaction_text and never the message), so Serve SMS needs it and
-- a parallel table would mean a second implementation of the constituent
-- timeline, the issues reader and the response CSV download.
--
-- Additive: every existing row keeps its poll_id, and outreach_id is NULL, so
-- the CHECK below can never fail on the backfill scan. When polls later moves
-- into outreach, those rows flip poll_id -> outreach_id rather than being
-- copied into a different shape.

-- AlterTable
ALTER TABLE "poll_individual_message" ADD COLUMN     "outreach_id" INTEGER,
ALTER COLUMN "poll_id" DROP NOT NULL;

-- A real exactly-one, unlike outreach_scope_check (which is an OR, because a
-- Win outreach row legitimately carries both campaignId and organization_slug).
-- A message row belongs to one product or the other, never both and never
-- neither.
ALTER TABLE "poll_individual_message" ADD CONSTRAINT "poll_individual_message_scope_check"
  CHECK (num_nonnulls("poll_id", "outreach_id") = 1);

-- CreateTable
CREATE TABLE "outreach_text_recipient" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outreach_id" INTEGER NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "outreach_text_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outreach_text_recipient_outreach_id_phone_idx" ON "outreach_text_recipient"("outreach_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_text_recipient_outreach_id_person_id_key" ON "outreach_text_recipient"("outreach_id", "person_id");

-- CreateIndex
CREATE INDEX "poll_individual_message_elected_office_id_outreach_id_perso_idx" ON "poll_individual_message"("elected_office_id", "outreach_id", "person_cell_phone");

-- AddForeignKey
ALTER TABLE "outreach_text_recipient" ADD CONSTRAINT "outreach_text_recipient_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_text_recipient" ADD CONSTRAINT "outreach_text_recipient_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_individual_message" ADD CONSTRAINT "poll_individual_message_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
--
-- Added NOT VALID here; VALIDATE runs in the NEXT migration file, and the
-- separation is the whole point. Prisma wraps each migration file in one
-- BEGIN/COMMIT, so ADD ... NOT VALID followed by VALIDATE in the same file
-- would hold the ACCESS EXCLUSIVE lock across the validation scan anyway —
-- exactly what a plain ADD CONSTRAINT does. Two files, two transactions, lock
-- released in between. The comment above is about
-- whether the constraint can FAIL on existing rows (it cannot) — which is a
-- different question from how long it LOCKS. A plain ADD CONSTRAINT scans
-- every row under ACCESS EXCLUSIVE regardless of the outcome, and this table
-- carries one row per SMS exchange across every poll ever run, so that scan
-- would block all reads and writes for the duration. NOT VALID takes a brief
-- lock and skips the scan; VALIDATE then does the scan under SHARE UPDATE
-- EXCLUSIVE, which blocks neither.
--
-- Note the sibling outreach_scope_check migration makes the same conflation in
-- its comment. Not changed here (migrations are immutable once applied), but
-- it is not a precedent to copy.
ALTER TABLE "poll_individual_message" ADD CONSTRAINT "poll_individual_message_scope_check"
  CHECK (num_nonnulls("poll_id", "outreach_id") = 1) NOT VALID;

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

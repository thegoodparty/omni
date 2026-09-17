-- ADR 0008. "What happened?" — the follow-up behind a `not_a_voter` outcome —
-- joins the layered status model as a fourth field, the same way do-not-knock
-- did in ADR 0007. It is not a column on contact_interaction_door_knock: the
-- outcome already ships without a reason (the two-tap flow never asks), so the
-- column would be nullable-and-conditional on outcome, a shape the schema
-- cannot enforce; and suppression needs the current answer per person as a set,
-- which is what contact_current_status's (organization_slug, field, value)
-- index already serves.
--
-- Nothing is deleted or rewritten by this feature. The prototype's phrasing
-- ("remove this address from that person's voter record") is not implemented:
-- people, addresses, and the L2-derived voter data are read-only here, and the
-- reason is recorded as an appended event instead.
--
-- No backfill from historical `not_a_voter` outcomes. Those rows were logged
-- before the question existed, so their reason is genuinely unknown, and
-- guessing one would suppress people on evidence nobody gave.
--
-- Additive only: `ALTER TYPE ... ADD VALUE` and a new type, with nothing below
-- reading or comparing against the new literal (which a migration adding an
-- enum value may not do in the same transaction).

-- AlterEnum
ALTER TYPE "ContactStatusField" ADD VALUE 'not_a_voter';

-- CreateEnum
-- The value vocabulary. Like DoNotKnockStatus, this type backs no column —
-- contact_current_status.value and contact_status_event.to_value are plain
-- text, each field's vocabulary enforced in Zod at the write boundary — it
-- exists to generate the contracts enum that does the enforcing.
CREATE TYPE "NotAVoterStatus" AS ENUM ('moved', 'deceased', 'cleared');

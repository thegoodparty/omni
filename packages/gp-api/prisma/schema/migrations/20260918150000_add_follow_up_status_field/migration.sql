-- Serve's standing "this constituent asked to be followed up with" joins the
-- layered status model as a fifth field, the same way do-not-knock did in
-- ADR 0007 and not-a-voter in ADR 0008.
--
-- It is not a column on the interaction tables, and the distinction is the
-- point: `contact_interaction_phone_banking.follow_up` and
-- `contact_interaction_door_knock.follow_up` answer "did this ONE call or
-- knock end owing this person something", which is a fact about that
-- conversation and must stay immutable. This field answers "is anything still
-- owed", which is a fact about the person that an official toggles as they
-- work through people — reversible, attributable, and queryable as a set,
-- which is what contact_current_status's (organization_slug, field, value)
-- index already serves.
--
-- Serve-only. The two editable statuses above it are Win's; this one is
-- written from the Serve follow-up question (phone banking and door knocking)
-- and from the CRM contact card's toggle, and ContactsService rejects it for a
-- non-`eo-` org the same way it rejects the other two for an `eo-` one.
--
-- No backfill from the follow-up answers already on those interaction rows.
-- Latest-answer-wins is the rule going forward, but replaying history would
-- raise flags on people whose request may long since have been met, and an
-- official cannot tell a stale flag from a live one.
--
-- Additive only: `ALTER TYPE ... ADD VALUE` and a new type, with nothing below
-- reading or comparing against the new literal (which a migration adding an
-- enum value may not do in the same transaction).

-- AlterEnum
ALTER TYPE "ContactStatusField" ADD VALUE 'follow_up';

-- CreateEnum
-- The value vocabulary. Like DoNotKnockStatus and NotAVoterStatus, this type
-- backs no column — contact_current_status.value and
-- contact_status_event.to_value are plain text, each field's vocabulary
-- enforced in Zod at the write boundary — it exists to generate the contracts
-- enum that does the enforcing.
CREATE TYPE "FollowUpStatus" AS ENUM ('requested', 'cleared');

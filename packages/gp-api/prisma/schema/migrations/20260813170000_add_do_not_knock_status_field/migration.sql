-- ADR 0007. Do-not-knock joins the layered status model as a third field
-- rather than a new table or a `support_status` value: a refusal is an
-- observation of one conversation, do-not-knock is a standing instruction, and
-- one override column cannot mean both.
--
-- No backfill from historical refusals. `refused_to_engage` means "not today",
-- and inferring a standing instruction from a single bad conversation would
-- silently shrink every future walk list on evidence the candidate never gave
-- — and once written, an inferred flag is indistinguishable from a real one.
--
-- Additive only, so no enum rename dance: `ALTER TYPE ... ADD VALUE` is enough
-- and existing rows are untouched. Nothing below reads or compares against the
-- new literal, which a migration adding an enum value may not do in the same
-- transaction.

-- AlterEnum
ALTER TYPE "ContactStatusField" ADD VALUE 'do_not_knock';

-- CreateEnum
-- The value vocabulary. contact_current_status.value and
-- contact_status_event.to_value are plain text columns (each field's own
-- vocabulary is enforced at the write boundary in Zod), so this type is not
-- referenced by any column — it exists to generate the contracts enum that
-- does the enforcing.
CREATE TYPE "DoNotKnockStatus" AS ENUM ('active', 'cleared');

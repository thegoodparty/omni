-- Serve's civic panel joins the layered status model as a sixth field: the
-- constituents who said yes to being asked for feedback. One panel per office,
-- so the people at `member` are the panel; a list built off this field is how
-- an official reaches them.
--
-- A person-level standing fact, reversible and attributable, like follow_up:
-- the contact card toggles it today, and a yes to a panel invitation (text,
-- door, or call) writes it next. No backfill: nobody has been asked yet.
--
-- Additive only: `ALTER TYPE ... ADD VALUE` and a new type, with nothing below
-- reading the new literal (which a migration adding an enum value may not do in
-- the same transaction).

-- AlterEnum
ALTER TYPE "ContactStatusField" ADD VALUE 'civic_panel';

-- CreateEnum
-- Backs no column, like FollowUpStatus: it generates the contracts enum that
-- enforces the field's vocabulary at the write boundary.
CREATE TYPE "CivicPanelStatus" AS ENUM ('member', 'left');

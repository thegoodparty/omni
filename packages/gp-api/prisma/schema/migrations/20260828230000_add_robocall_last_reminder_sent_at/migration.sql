-- AlterTable
-- When the last hold-failure "fix your card" reminder was sent for a draft.
-- Nullable and additive; existing rows stay null (never reminded yet).
ALTER TABLE "outreach_robocall" ADD COLUMN "last_reminder_sent_at" TIMESTAMP(3);

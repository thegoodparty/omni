-- A rating names the AgentMessage it rates, always. #3893 left the column
-- nullable for one deploy because #3872's backfill could not key every row and
-- a startup migration that refused over one would have failed the container's
-- boot. Prod has since been counted: every gp-api task logged
-- `chat_message_feedback unkeyed count` with `unkeyed: 0` on 2026-11-19
-- (release 44568453599), so no row is null and the constraint is safe to add.
--
-- Plain DDL, no guard: this runs at boot, where a RAISE would fail the
-- migration and leave a record in _prisma_migrations that every later deploy
-- blocks on.
ALTER TABLE "chat_message_feedback"
  ALTER COLUMN "agent_message_id" SET NOT NULL;

-- Validate the scope CHECK added NOT VALID by the previous migration.
--
-- Deliberately its own file: Prisma runs each migration in its own
-- transaction, so the ACCESS EXCLUSIVE lock taken to add the constraint has
-- been released by the time this runs. VALIDATE then scans under SHARE UPDATE
-- EXCLUSIVE, which blocks neither reads nor writes — which is the only reason
-- the NOT VALID split buys anything on a table this size.

ALTER TABLE "poll_individual_message"
  VALIDATE CONSTRAINT "poll_individual_message_scope_check";

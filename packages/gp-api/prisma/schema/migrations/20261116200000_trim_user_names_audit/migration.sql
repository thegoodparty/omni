-- Two one-time changes to user names, in one migration so they commit or roll
-- back together.
--
-- 1. Record the pre-trim values of every row the trim will change, so the
--    change can be undone by hand later.
-- 2. Trim user.first_name / user.last_name, and rebuild user.name where
--    spacing is the only thing that differs.
--
-- Why the audit table: 1,252 of the affected 6,618 rows differ from a clean row
-- only by a trailing space, so after the update there is no way to tell which
-- rows were padded and which were always clean. Without this record, undoing
-- the trim is a guess. The table is deliberately separate from the `user` table
-- and has no foreign key, so it survives a user being deleted.
--
-- Ordered before the update for the obvious reason: `first_name_before` has to
-- be read from the row as it is now, not after it is trimmed. Both statements
-- read the same predicate, so they cover the same rows.
--
-- Not re-runnable by design, and it does not need to be: Prisma records an
-- applied migration and never replays it. Replaying the file by hand fails on
-- CREATE TABLE and then on the primary key, which is the safe direction. The
-- UPDATE alone is a no-op on a second run, since it finds nothing left to trim.
--
-- btrim with no character set strips spaces only, which is what the rows
-- actually carry: every dirty row is a plain space, none is a tab or newline.
--
-- User.name is `first_name || ' ' || last_name`, so trimming the parts would
-- leave the full name holding the space they lost. Rebuild it here too, but
-- only where spacing is the only thing that differs: a name with content of its
-- own (a middle name, say) is not ours to overwrite. Both columns are computed
-- from the pre-update row, which is why this is one statement.
--
-- nullif keeps a part that trims to '' out of the join, so a row with a blank
-- last name does not come back as 'First '.
CREATE TABLE "user_name_trim_audit" (
    "user_id" integer NOT NULL,
    "first_name_before" TEXT,
    "last_name_before" TEXT,
    "name_before" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_name_trim_audit_pkey" PRIMARY KEY ("user_id")
);

INSERT INTO "user_name_trim_audit" (
    "user_id", "first_name_before", "last_name_before", "name_before"
)
SELECT id, first_name, last_name, name
FROM "user"
WHERE
    first_name <> btrim(first_name)
    OR last_name <> btrim(last_name);

UPDATE "user"
SET
    first_name = btrim(first_name),
    last_name = btrim(last_name),
    name = CASE
        WHEN name IS DISTINCT FROM concat_ws(
            ' ', nullif(btrim(first_name), ''), nullif(btrim(last_name), '')
        )
        AND regexp_replace(name, '[[:space:]]', '', 'g')
            = regexp_replace(btrim(first_name) || btrim(last_name), '[[:space:]]', '', 'g')
        THEN concat_ws(
            ' ', nullif(btrim(first_name), ''), nullif(btrim(last_name), '')
        )
        ELSE name
    END
WHERE
    first_name <> btrim(first_name)
    OR last_name <> btrim(last_name);

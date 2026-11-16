-- One-time backfill: a sign-up bug left leading/trailing whitespace on
-- user.first_name / user.last_name. The write paths trim now (see
-- normalizePersonName), so this is the historical residue only.
--
-- It records the values it is about to overwrite, in the same statement that
-- overwrites them, so the change can be undone exactly.
--
-- Why the record: 1,252 of the affected rows differ from an always-clean row
-- only by a trailing space, so after the update there is no way to tell which
-- rows were padded and which were not. Without it, undoing the trim is a guess.
-- The table is separate from `user` with no foreign key, so it survives a user
-- being deleted, and is meant to be dropped once the change no longer needs to
-- be reversible.
--
-- Why one statement and not an INSERT followed by an UPDATE: the migration runs
-- in READ COMMITTED, where each statement takes its own snapshot. With two
-- statements, a row written by a still-running old task between them is matched
-- by the UPDATE but missed by the INSERT, so it gets trimmed and not recorded,
-- and that row can never be restored. Verified against a concurrent writer.
-- Wrapping the INSERT in a data-modifying CTE and driving the UPDATE from its
-- RETURNING makes the audited set and the trimmed set the same rows by
-- construction, so the two cannot disagree.
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
--
-- Not re-runnable by design, and it does not need to be: Prisma records an
-- applied migration and never replays it. Replaying it by hand fails on
-- CREATE TABLE and then on the primary key, which is the safe direction.
CREATE TABLE "user_name_trim_audit" (
    "user_id" integer NOT NULL,
    "first_name_before" TEXT,
    "last_name_before" TEXT,
    "name_before" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_name_trim_audit_pkey" PRIMARY KEY ("user_id")
);

WITH captured AS (
    INSERT INTO "user_name_trim_audit" (
        "user_id", "first_name_before", "last_name_before", "name_before"
    )
    SELECT id, first_name, last_name, name
    FROM "user"
    WHERE
        first_name <> btrim(first_name)
        OR last_name <> btrim(last_name)
    RETURNING "user_id"
)
UPDATE "user" AS u
SET
    first_name = btrim(u.first_name),
    last_name = btrim(u.last_name),
    name = CASE
        WHEN u.name IS DISTINCT FROM concat_ws(
            ' ', nullif(btrim(u.first_name), ''), nullif(btrim(u.last_name), '')
        )
        AND regexp_replace(u.name, '[[:space:]]', '', 'g')
            = regexp_replace(btrim(u.first_name) || btrim(u.last_name), '[[:space:]]', '', 'g')
        THEN concat_ws(
            ' ', nullif(btrim(u.first_name), ''), nullif(btrim(u.last_name), '')
        )
        ELSE u.name
    END
FROM captured AS c
WHERE u.id = c."user_id";

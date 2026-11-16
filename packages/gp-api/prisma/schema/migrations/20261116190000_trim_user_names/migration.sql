-- One-time backfill: a sign-up bug left leading/trailing whitespace on
-- user.first_name / user.last_name. The write paths trim now (see
-- normalizePersonName), so this is the historical residue only.
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

-- Preserve the audience of every saved list cut by language 'other'.
--
-- 'other' used to mean "not English, not Spanish, OR no language recorded" —
-- the `OR Language_Code IS NULL` in buildLanguageFilter. This release splits
-- the null half out into its own 'unknown' value, which is the point: a list
-- meaning "speaks something else" was quietly also returning everyone whose
-- language was never recorded, roughly 60% of a district.
--
-- But a list SAVED under the old meaning was saved against the old audience.
-- Left alone, every one of them would silently shrink the next time it was
-- counted, downloaded or knocked — the filter changing under a list nobody
-- edited. Adding 'unknown' beside 'other' reproduces the old predicate
-- exactly ((NOT IN (...) AND NOT NULL) OR IS NULL), so these lists keep
-- addressing the same people; the new split is available to anyone who edits
-- the pills from here on.
--
-- This is the conservative direction on purpose. It preserves audiences
-- rather than retroactively applying the fix, so nothing anyone already built
-- on changes size without them asking. The cost is that existing lists still
-- carry the broad meaning until edited, which is visible in the pills (both
-- Other and Unknown read as checked) rather than hidden in a predicate.
--
-- Idempotent: the NOT guard means a re-run is a no-op, and lists that already
-- name 'unknown' are left alone.
--
-- array_position rather than `= ANY`, because `= ANY` is unsafe here. If
-- language_codes holds a NULL element, `'unknown' = ANY (...)` evaluates to
-- NULL rather than false, so `NOT (NULL)` is NULL, the whole WHERE is NULL,
-- and the row is skipped — which is the one outcome this migration exists to
-- prevent, since that list would then silently shrink. array_position returns
-- a plain NULL-or-integer regardless of NULL elements, so the guard holds.
-- Prisma's typed client will not write a NULL into a String[], so reaching
-- this needs raw SQL or a data anomaly; it is guarded because the cost of
-- being wrong is an audience changing size unasked.
UPDATE voter_file_filter
SET language_codes = array_append(language_codes, 'unknown')
WHERE array_position(language_codes, 'other') IS NOT NULL
  AND array_position(language_codes, 'unknown') IS NULL;

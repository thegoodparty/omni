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
UPDATE voter_file_filter
SET language_codes = array_append(language_codes, 'unknown')
WHERE 'other' = ANY (language_codes)
  AND NOT ('unknown' = ANY (language_codes));

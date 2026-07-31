-- Renames the saved-filter party bucket from "unknown" (null/blank only) to
-- "other" (null/blank OR any non-major-party value), matching the display
-- 'Other' bucket. A rename (not drop+add) preserves existing saved-filter
-- selections; those filters now resolve to the broader Other semantics.
ALTER TABLE "voter_file_filter" RENAME COLUMN "party_unknown" TO "party_other";

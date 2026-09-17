-- Residence_Addresses_AddressLine is 100% populated, so a has-address filter
-- matches every voter and can never narrow a list. The column added by
-- 20260903190310 is dropped rather than edited out of that migration, which
-- has already been applied to this PR's preview database.
ALTER TABLE "voter_file_filter" DROP COLUMN IF EXISTS "has_address";

-- Attribution + revert history for privacy takedowns.
--
-- applied_by / cleared_by: gp-admin reaches gp-api over a shared M2M token, so
-- the operator cannot be derived from the request. The caller names itself and
-- applied_by is NOT NULL, which makes an unattributed takedown unrecordable.
--
-- cleared_at: reverting a takedown now sets this instead of deleting the row, so
-- the fact that a person was taken down (and who reverted it) outlives the
-- revert. A takedown is ACTIVE only while cleared_at IS NULL; every read of the
-- flag filters on it.

-- AlterTable
-- Backfilled rather than left nullable: any row predating this migration was
-- written by an engineer with direct API access, which is the honest value.
ALTER TABLE "person_profile_removal"
    ADD COLUMN "applied_by" TEXT NOT NULL DEFAULT 'unattributed (pre-audit)',
    ADD COLUMN "cleared_at" TIMESTAMP(3),
    ADD COLUMN "cleared_by" TEXT;

-- The default exists only to backfill; new writes must supply the actor.
ALTER TABLE "person_profile_removal" ALTER COLUMN "applied_by" DROP DEFAULT;

-- Active-takedown lookups (the public render gate) and the admin list both
-- filter on cleared_at, and the gate runs on every uncached profile request.
CREATE INDEX "person_profile_removal_cleared_at_idx" ON "person_profile_removal"("cleared_at");

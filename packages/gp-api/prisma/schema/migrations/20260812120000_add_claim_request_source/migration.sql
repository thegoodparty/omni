-- Records which of the two public claim forms produced a lead row. Both POST
-- the same endpoint but mean opposite things: `notify` is a visitor nudging
-- someone else to claim their page, `owner` is the person claiming it
-- themselves. Only `notify` feeds the candidate's HubSpot
-- `candidate_profile_requests` counter.
--
-- Nullable with no default and no backfill: rows written before the marketing
-- site sent the discriminator are genuinely unattributed, and guessing them
-- into either bucket would either inflate visitor demand with owners' own
-- submissions or fabricate history. They stay out of the count.

-- CreateEnum
CREATE TYPE "ProfileClaimRequestSource" AS ENUM ('notify', 'owner');

-- DropIndex
-- Superseded by the composite below, whose leading column serves the same
-- person_id lookups.
DROP INDEX "person_profile_claim_request_person_id_idx";

-- AlterTable
ALTER TABLE "person_profile_claim_request" ADD COLUMN     "source" "ProfileClaimRequestSource";

-- CreateIndex
CREATE INDEX "person_profile_claim_request_person_id_source_idx" ON "person_profile_claim_request"("person_id", "source");

-- Opt-in flag from the unclaimed-profile claim/notify modal's marketing
-- consent checkbox. Recorded only; no downstream sync (e.g. HubSpot) here.
-- Defaults false so existing rows and consent-less submits stay opted out.

-- AlterTable
ALTER TABLE "person_profile_claim_request" ADD COLUMN     "marketing_consent" BOOLEAN NOT NULL DEFAULT false;

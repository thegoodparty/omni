/*
  Warnings:

  - The values [introduce,persuade,event,vote_early,election_day] on the enum `PhoneBankingPurpose` are renamed to their canonical outreach-vocabulary equivalents (introduce_myself, persuade_voters, event_invite, early_voting, election_day_turnout). Existing rows are remapped via an explicit CASE, not a direct cast, so they land on the correct new label rather than failing the type swap.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PhoneBankingPurpose_new" AS ENUM ('introduce_myself', 'persuade_voters', 'event_invite', 'early_voting', 'election_day_turnout', 'custom', 'explain_decision', 'community_input', 'share_resource');
ALTER TABLE "phone_banking_list" ALTER COLUMN "purpose" TYPE "PhoneBankingPurpose_new" USING (
  CASE "purpose"::text
    WHEN 'introduce' THEN 'introduce_myself'
    WHEN 'persuade' THEN 'persuade_voters'
    WHEN 'event' THEN 'event_invite'
    WHEN 'vote_early' THEN 'early_voting'
    WHEN 'election_day' THEN 'election_day_turnout'
    ELSE "purpose"::text
  END
)::"PhoneBankingPurpose_new";
ALTER TYPE "PhoneBankingPurpose" RENAME TO "PhoneBankingPurpose_old";
ALTER TYPE "PhoneBankingPurpose_new" RENAME TO "PhoneBankingPurpose";
DROP TYPE "public"."PhoneBankingPurpose_old";
COMMIT;

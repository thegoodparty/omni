-- Serve's "who still owes a follow-up" audience, as a saved-filter dimension.
--
-- Unlike every other column on voter_file_filter, this one does not name a
-- voter-file attribute. It resolves against contact_current_status's
-- `follow_up` field, the same way the contacts_made_* block resolves against
-- the interaction tables — so the two sit together and neither goes through
-- convertVoterFileFilterToFilters' generic loop.
--
-- It selects people whose standing flag is STILL `requested`, not everyone
-- who ever answered yes on a call or at a door. A campaign's own
-- `byFollowUp.yes` count is the historical fact and cannot shrink; this is
-- what is outstanding now, so an official can work it down and watch it go to
-- zero. AND-ing it with an activity condition for one outreach is what makes
-- "who from this closed campaign still needs calling back" expressible as an
-- ordinary saved list, reusable by phone banking and every other channel.
--
-- Additive and defaulted false, so every existing filter keeps resolving
-- exactly as it does today.

-- AlterTable
ALTER TABLE "voter_file_filter"
  ADD COLUMN "follow_up_requested" BOOLEAN DEFAULT false;

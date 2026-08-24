// Stable error code returned whenever an org cannot be served voter data:
// its district can't be resolved, the district has no pre-computed stats, or
// the campaign fails the federal/state download-access rule. The webapp maps
// it to a clean empty/ineligible state instead of treating the 4xx as an
// error, so every producer of that state must carry this code.
//
// Lives here rather than in `contacts/` because `peopleDb/` raises it too, and
// peopleDb must not depend on contacts (the dependency runs the other way).
export const VOTER_DATA_UNAVAILABLE_ERROR_CODE = 'VOTER_DATA_UNAVAILABLE'

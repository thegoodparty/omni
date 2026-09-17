// Stable error code returned whenever an org cannot be served voter data:
// its district can't be resolved, the district has no pre-computed stats, or
// the campaign fails the federal/state download-access rule. The webapp maps
// it to a clean empty/ineligible state instead of treating the 4xx as an
// error, so every producer of that state must carry this code.
//
// Lives here rather than in `contacts/` because `peopleDb/` raises it too, and
// peopleDb must not depend on contacts (the dependency runs the other way).
export const VOTER_DATA_UNAVAILABLE_ERROR_CODE = 'VOTER_DATA_UNAVAILABLE'

// The two ways a voter READ fails, as opposed to the eligibility state above.
// Both are 5xx, and both carry a message written for the person who will read
// it rather than for a log.
//
// They need codes because status alone cannot tell a client which 5xx messages
// are safe to show. A 502 from the people-db says "this is a connection
// problem, not an empty district"; a 502 from Geoapify says "Route
// optimization returned an unidentifiable stop". The first is the answer to
// the question the candidate is asking and the second is infrastructure
// talking to itself, so a client that keys on the status shows both or
// neither — and showing neither is what made a 60-second warehouse timeout
// read as a generic "try again in a moment".
export const VOTER_QUERY_TIMEOUT_ERROR_CODE = 'VOTER_QUERY_TIMEOUT'
export const VOTER_DATA_UNREACHABLE_ERROR_CODE = 'VOTER_DATA_UNREACHABLE'

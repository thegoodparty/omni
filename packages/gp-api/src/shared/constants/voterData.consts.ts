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

// A third read failure, and the only one that is a wait rather than a fault:
// the Databricks warehouse had not started executing the statement yet, so the
// read gave up in seconds instead of spending the full minute on it. It is a
// 503 rather than a 504 because the same request works once the warehouse is
// up, and a code of its own so "the warehouse is booting" does not read as
// "this query is too expensive" in a log or in the product.
export const VOTER_DATA_STARTING_ERROR_CODE = 'VOTER_DATA_STARTING'

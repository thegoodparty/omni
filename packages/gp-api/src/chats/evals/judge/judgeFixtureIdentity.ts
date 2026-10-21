// THE ONE DEV ACCOUNT the judge's gp-api-reading background agents run as.
//
// The broker reaches gp-api as the run ticket's user, so an agent whose main
// path reads gp-api needs a user gp-api can find and an organization with an
// elected office that user owns. scripts/seed-judge-fixture.ts writes exactly
// these rows and the dispatch names exactly these values, so both read them
// from here and the two cannot drift apart.
//
// The clerk id names no Clerk user. gp-api's session guard looks the row up by
// clerkId and asks Clerk only when the row is missing, and the broker signs
// the token itself, so nothing on this path ever reaches Clerk. It has to
// start with `user_`, which is the guard's test for a user id.

// Not a person and not a mailbox anyone reads: example.com is reserved for
// exactly this (RFC 2606), and a public case list should carry no real address.
export const JUDGE_USER_EMAIL = 'judge-sweep@example.com'

export const JUDGE_FIXTURE = {
  clerkUserId: 'user_judge_fixture',
  // Under the `judge-` prefix the dispatch requires, like every judge slug.
  orgSlug: 'judge-fixture',
  email: JUDGE_USER_EMAIL,
} as const

import {
  JUDGE_FIXTURE_ENV_NAMES,
  JUDGE_PLACEHOLDERS,
  PLACEHOLDER_NAMES,
  type PlaceholderName,
} from './caseParams'

// The values for the six background agents whose input_schema names an
// identifier a case list cannot carry: an organization slug, a race id, the
// candidate's own address. judgeIdentifiers.ts makes them up per sweep; this
// is the shape they take and how they reach both arms.
//
// NONE OF THE THREE IS A LIVE LOOKUP UNDER THIS HARNESS, and that was checked
// rather than assumed, because it decides whether anything real has to exist.
//
// `organization_slug` looked like the real one: top_community_issues and
// trending_issues do read the issue feed. But GET_community_issues takes no
// slug argument — its query is `{ list }` alone — and the org comes from
// `@UseElectedOffice()`, which reads `X-Organization-Slug`. The broker sets
// that header from `ticket.organization_slug`, and a judge dispatch pins that
// to `judge-*` (JUDGE_ORG_SLUG_PREFIX in runners/background.ts) so a run
// cannot overwrite a real organization's `latest.json`. So the slug in params
// is echoed into the artifact and scopes nothing. (Those two agents are
// blocked in agents.ts for a further reason: the broker calls gp-api as the
// ticket's user, and a judge dispatch carries none.)
//
// `race_id` never was: all three manifests call it a trace and idempotency
// identifier the agent does not reason over or look anything up with.
// `user_email` is matched only against the roster inside the same params
// object.
//
// They still come from the sweep rather than from the case list, for two
// reasons that survive the above: a field documented as a BallotReady
// brHashId should carry one, and a public case list should carry no email
// address.

// The race the case lists name: the pair src/testFixtures uses as its
// DEFAULT_RACE and the e2e suite provisions against, a live BallotReady office
// on the dev election-api. Named here rather than defaulted, so the id
// judgeIdentifiers.ts resolves is one this side can identify.
export const JUDGE_FIXTURE_RACE = {
  zip: '82001',
  office: 'Cheyenne City Council - Ward 1',
} as const

export interface JudgeFixtureIdentifiers {
  // A `judge-` slug for an organization that does not exist; see above.
  orgSlug: string
  // The BallotReady brHashId of JUDGE_FIXTURE_RACE.
  raceId: string
  // A reserved address that is nobody's.
  userEmail: string
}

// ---------------------------------------------------------------------------
// Reaching both arms
// ---------------------------------------------------------------------------

// The two arms are two processes in two worktrees, so nothing in memory here
// reaches both. The identifiers therefore travel the way JUDGE_DATA_VERSION
// does: resolved once outside the arms, exported into each one's environment,
// read back by `parseArmEnv` as `ArmEnv.fixtureValues`. Two arms with
// different values would be comparing two inputs, and every verdict would then
// be an artifact of that rather than of the branch.
//
// This is the exporting half only. The reading half is `ArmEnvSchema` in
// sweepEnv.ts, which is where the arm's whole environment is declared and
// where blank-means-unset is defined once for these three and the Delta
// version together — a second reader here would be a second contract for what
// an arm may read.
// Keyed by the union rather than by `string`, so dropping an entry is a
// typecheck failure instead of a variable an arm silently never receives.
export const fixtureEnv = (
  identifiers: JudgeFixtureIdentifiers,
): Record<(typeof JUDGE_FIXTURE_ENV_NAMES)[PlaceholderName], string> => ({
  [JUDGE_FIXTURE_ENV_NAMES.orgSlug]: identifiers.orgSlug,
  [JUDGE_FIXTURE_ENV_NAMES.raceId]: identifiers.raceId,
  [JUDGE_FIXTURE_ENV_NAMES.userEmail]: identifiers.userEmail,
})

// Which environment variable supplies which token, for the sentence a sweep
// operator reads when one of them is missing.
export const describeFixtureEnv = (): string =>
  PLACEHOLDER_NAMES.map(
    (name) =>
      `${JUDGE_PLACEHOLDERS[name]} from ${JUDGE_FIXTURE_ENV_NAMES[name]}`,
  ).join(', ')

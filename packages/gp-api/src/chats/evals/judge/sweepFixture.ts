import {
  DeleteTestFixtureUsersResponseSchema,
  RaceListItemArraySchema,
  TestFixtureUserResponseSchema,
  type DeleteTestFixtureUsersResponse,
  type TestFixtureState,
} from '@goodparty_org/contracts'
import { Headers, MimeTypes } from 'http-constants-ts'
import { JsonValueSchema, type JsonValue } from './record'
import {
  JUDGE_FIXTURE_ENV_NAMES,
  JUDGE_PLACEHOLDERS,
  PLACEHOLDER_NAMES,
  type PlaceholderName,
} from './caseParams'

// The per-sweep fixture for the six background agents whose input_schema names
// an identifier a case list cannot carry. The only supported way to get one is
// POST /v1/test-fixtures/users — which mints a qa-<uuid>@goodparty.org user in
// a known product state, behind AdminOrM2MGuard, 404 outside dev/preview.
//
// Those users are swept after about 24 hours, so the fixture is per SWEEP,
// never per case list: minted before the arms run, substituted into every
// case's params, deleted after. This is the background equivalent of
// runners/seedChatOrg.ts, which derives a chat case's org for the run rather
// than pointing at a long-lived one.
//
// NONE OF THE THREE IS A LIVE LOOKUP UNDER THIS HARNESS, and that was checked
// rather than assumed, because an earlier version of this comment claimed the
// opposite and it decided how much a fixture is worth.
//
// `organization_slug` looked like the real one: top_community_issues and
// trending_issues do read the issue feed. But GET_community_issues takes no
// slug argument — its query is `{ list }` alone — and the org comes from
// `@UseElectedOffice()`, which reads `X-Organization-Slug`. The broker sets
// that header from `ticket.organization_slug`, and a judge dispatch pins that
// to `judge-*` (JUDGE_ORG_SLUG_PREFIX in runners/background.ts) so a run
// cannot overwrite a real organization's `latest.json`. So the slug in params
// is echoed into the artifact and scopes nothing.
//
// `race_id` never was: all three manifests call it a trace and idempotency
// identifier the agent does not reason over or look anything up with.
// `user_email` is matched only against the roster inside the same params
// object.
//
// They still come from here rather than from the case list, for two reasons
// that survive the above: a field documented as a BallotReady brHashId should
// carry one, and a public case list should carry no email address. But the
// stronger justification — that an `eo-` organization has to exist for the
// feed read to work — does not hold, so whether these three agents need a
// minted Clerk identity at all is an open question on the PR rather than a
// settled one here.
//
// ONE fixture, in state `serve-won-race`, serves all six. It is the only state
// that produces both halves: promoteWonRace creates an ElectedOffice, so
// `orgSlug` is the `eo-` organization the three organization_slug agents read
// their issue feed from, and it also runs createLaunchedCampaign, so the user
// is bound to a real BallotReady race the three race_id agents can name. A
// plain `serve` user has no campaign and therefore no race; a `free-win` or
// `pro-win` user's `orgSlug` is `campaign-<id>` and nothing resolves an
// elected office from it. Minting two fixtures instead would also spend twice
// the Clerk Backend API budget that src/testFixtures/AGENTS.md warns is the
// scarce resource here.

// The race the fixture binds. The same pair src/testFixtures uses as its
// DEFAULT_RACE and the e2e suite provisions against: a live BallotReady office
// on the dev election-api with voter rows in the dev people-db. Named here
// rather than defaulted, because the race id is resolved from this pair and a
// fixture that silently fell back to its own default would be bound to a race
// this side could not identify.
export const JUDGE_FIXTURE_RACE = {
  zip: '82001',
  office: 'Cheyenne City Council - Ward 1',
} as const

const FIXTURE_STATE: TestFixtureState = 'serve-won-race'

const FIXTURE_USERS_PATH = '/v1/test-fixtures/users'
const RACES_BY_YEAR_PATH = '/v1/elections/races-by-year'

// The one network edge, so a test stubs the whole fixture at its boundary and
// nothing real is minted. `request` resolves the parsed JSON body and throws
// on any non-2xx, which is what makes every caller below able to treat a
// resolved value as a response.
export interface FixtureApi {
  request(args: {
    method: 'GET' | 'POST' | 'DELETE'
    path: string
    query?: Record<string, string>
    body?: JsonValue
    // Whether to send the admin/M2M bearer. Default true, because the
    // test-fixtures routes are behind AdminOrM2MGuard — but the race lookup
    // is `@PublicAccess()`, and an admin credential riding on a call that
    // needs none widens its blast radius for nothing.
    auth?: boolean
  }): Promise<JsonValue>
}

export class JudgeFixtureError extends Error {}

export interface FixtureApiOptions {
  // The dev or preview gp-api. The endpoint 404s anywhere else, by design.
  baseUrl: string
  // An admin or M2M bearer token: the controller is behind AdminOrM2MGuard.
  token: string
}

// The real edge. Kept to this one adapter so every other function here is
// exercised against a stub and a test can never mint anything.
// A mint is a Clerk round trip plus a few writes, so this is generous. It
// exists because Node's fetch has no request timeout of its own: only
// undici's 300s headers timeout applies, and an accepted-then-silent
// connection escapes even that. `mintJudgeFixture` runs BEFORE the arms, so a
// black-holed dev gp-api would park the whole Actions job until the job
// timeout and deliver no verdict; `deleteJudgeFixture` runs after a paid
// sweep, where a hang turns "cleanup is slow" into "the job was killed after
// the money was spent".
const FIXTURE_TIMEOUT_MS = 30_000

export const createFixtureApi = ({
  baseUrl,
  token,
}: FixtureApiOptions): FixtureApi => ({
  request: async ({ method, path, query, body, auth = true }) => {
    const url = new URL(path, baseUrl)
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value)
    }
    const response = await fetch(url, {
      method,
      headers: {
        ...(auth && { [Headers.AUTHORIZATION]: `Bearer ${token}` }),
        [Headers.CONTENT_TYPE]: MimeTypes.APPLICATION_JSON,
      },
      signal: AbortSignal.timeout(FIXTURE_TIMEOUT_MS),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    if (!response.ok) {
      // Status and route only. A failing create can echo the request back,
      // and this module's one hard rule is that nothing derived from a
      // fixture response body is ever put in a log line.
      throw new JudgeFixtureError(
        `${method} ${path} answered ${response.status}`,
      )
    }
    // NOT a bare JSON.parse, and that is the rule above rather than defensive
    // habit: V8 puts a snippet of its input in the message — `Unexpected
    // token 'x', "x{"passwor"... is not valid JSON` — so a 2xx body that is
    // not JSON would propagate the first bytes of a response carrying a
    // password. Re-thrown with the route and the length only.
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new JudgeFixtureError(
        `${method} ${path} answered ${response.status} with ` +
          `${text.length} byte(s) that are not JSON`,
      )
    }
    // Deliberately OUTSIDE the catch. Zod is safe to surface here and that
    // was checked, not assumed: its issues name a path and the expected type,
    // never the received value. Folding it in would report a schema drift —
    // the route growing a field, or returning null where a string is
    // declared — as "not JSON", which is false, and would discard the one
    // thing that makes such a drift diagnosable.
    return JsonValueSchema.parse(json)
  },
})

export interface JudgeFixtureIdentifiers {
  // The `eo-<electedOfficeId>` organization. What the three organization_slug
  // agents echo into their artifact and read their issue feed with.
  orgSlug: string
  // The BallotReady brHashId of the race the fixture's campaign was created
  // from. Resolved from the same zip + office pair the fixture was minted
  // with, through the same route testFixtures.service.ts matches on, so it is
  // the race the fixture is actually bound to rather than a plausible id.
  // Two reads of the same upstream rather than one, since the response has no
  // race id of its own; BallotReady moving between them is the only skew, and
  // it would show up as a fixture that failed to mint rather than silently.
  raceId: string
  // The fixture's own qa-<uuid>@goodparty.org address.
  userEmail: string
}

export interface JudgeFixture {
  identifiers: JudgeFixtureIdentifiers
  // Needed to delete it again; not a placeholder value.
  userId: number
}

// One place, because it is called from two: the unwind below, when a minted
// fixture turns out to be unusable, and the ordinary cleanup after the arms.
const deleteFixtureUser = (
  api: FixtureApi,
  userId: number,
): Promise<JsonValue> =>
  api.request({
    method: 'DELETE',
    path: FIXTURE_USERS_PATH,
    body: { userIds: [userId] },
  })

const resolveRaceId = async (api: FixtureApi): Promise<string> => {
  const races = RaceListItemArraySchema.parse(
    await api.request({
      method: 'GET',
      path: RACES_BY_YEAR_PATH,
      query: { zipcode: JUDGE_FIXTURE_RACE.zip },
      // `@PublicAccess()` on ElectionsController — no credential needed.
      auth: false,
    }),
  )
  const match = races.find(
    (race) => race.position.name === JUDGE_FIXTURE_RACE.office,
  )
  if (!match) {
    throw new JudgeFixtureError(
      `no race named "${JUDGE_FIXTURE_RACE.office}" for zip ` +
        `${JUDGE_FIXTURE_RACE.zip}; the fixture cannot be bound to a race ` +
        'this side can identify, so the race_id agents have no value',
    )
  }
  return match.id
}

// Resolved BEFORE the user is minted, so a sweep that cannot identify the race
// has cost nothing and leaked no Clerk identity. The fixture is then minted
// against the same pair, which is what makes the id above the one its campaign
// carries in `details.raceId`.
export const mintJudgeFixture = async (
  api: FixtureApi,
): Promise<JudgeFixture> => {
  const raceId = await resolveRaceId(api)
  // NEVER log this object, or anything derived from it wholesale. By contract
  // it carries the user's password, a session token and a single-use Clerk
  // sign-in ticket (src/testFixtures/AGENTS.md).
  const fixture = TestFixtureUserResponseSchema.parse(
    await api.request({
      method: 'POST',
      path: FIXTURE_USERS_PATH,
      body: { state: FIXTURE_STATE, race: { ...JUDGE_FIXTURE_RACE } },
    }),
  )
  if (fixture.electedOfficeId === undefined) {
    // The POST already created a Clerk user, an organization, a campaign and
    // — normally — an elected office. Throwing without deleting would discard
    // the only id that can reclaim it deliberately, leaving the hourly
    // sweepTestUsers cron as the only reaper and contradicting this
    // function's own claim above that a failure leaks no Clerk identity.
    // Clerk's Backend API budget is the scarce resource here
    // (src/testFixtures/AGENTS.md).
    //
    // Swallowed on purpose: the caller needs the reason the fixture is
    // unusable, not the reason the cleanup of an unusable fixture also
    // failed. The cron is the net for that.
    await deleteFixtureUser(api, fixture.userId).catch(() => undefined)
    throw new JudgeFixtureError(
      `the ${FIXTURE_STATE} fixture produced no elected office, so its ` +
        `organization "${fixture.orgSlug}" is not one the ` +
        'organization_slug agents can read an issue feed from',
    )
  }
  return {
    identifiers: {
      orgSlug: fixture.orgSlug,
      raceId,
      userEmail: fixture.email,
    },
    userId: fixture.userId,
  }
}

// A user the endpoint could not find is reported, not thrown: that is an
// ordinary outcome — the hourly sweepTestUsers cron may have got there
// first — and it arrives as `notFound` in a 200 body.
//
// A TRANSPORT failure still rejects, and that is deliberate rather than an
// oversight. This runs after the arms, so THE CALLER must not let it replace a
// finished sweep's outcome with a cleanup error; swallowing it here instead
// would hide a leaked Clerk identity from the one place that could report it.
// Wrap the call, do not weaken it.
// Takes only the id, because that is all a delete reads — and the delete runs
// in a later workflow step than the mint, where the identifiers are not in
// hand and the id is.
export const deleteJudgeFixture = async (
  api: FixtureApi,
  fixture: Pick<JudgeFixture, 'userId'>,
): Promise<DeleteTestFixtureUsersResponse> =>
  DeleteTestFixtureUsersResponseSchema.parse(
    await deleteFixtureUser(api, fixture.userId),
  )

// ---------------------------------------------------------------------------
// Reaching both arms
// ---------------------------------------------------------------------------

// The two arms are two processes in two worktrees, so nothing in memory here
// reaches both. The identifiers therefore travel the way JUDGE_DATA_VERSION
// does: resolved once outside the arms, exported into each one's environment,
// read back by `parseArmEnv` as `ArmEnv.fixtureValues`. An arm that minted its
// own fixture would compare two organizations, and every verdict would then be
// an artifact of the fixture rather than of the branch.
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

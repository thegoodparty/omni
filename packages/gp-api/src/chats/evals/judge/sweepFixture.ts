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
  JUDGE_PLACEHOLDERS,
  PLACEHOLDER_NAMES,
  type PlaceholderName,
  type PlaceholderValues,
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
// The three kinds of identifier are not equally load-bearing, and saying which
// is which is the point of this comment. `organization_slug` is a real lookup:
// top_community_issues and trending_issues read the current issue feed with
// GET_community_issues scoped to it, so it has to name an elected office that
// exists. `race_id` is not — all three manifests call it a trace and
// idempotency identifier the agent does not reason over or look anything up
// with — but it is still resolved from the live route rather than authored,
// because a field documented as a BallotReady brHashId should carry one.
// `user_email` is matched only against the roster inside the same params
// object; it comes from here so a public case list carries no address.
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
export const createFixtureApi = ({
  baseUrl,
  token,
}: FixtureApiOptions): FixtureApi => ({
  request: async ({ method, path, query, body }) => {
    const url = new URL(path, baseUrl)
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value)
    }
    const response = await fetch(url, {
      method,
      headers: {
        [Headers.AUTHORIZATION]: `Bearer ${token}`,
        [Headers.CONTENT_TYPE]: MimeTypes.APPLICATION_JSON,
      },
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
    return JsonValueSchema.parse(JSON.parse(text))
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

const resolveRaceId = async (api: FixtureApi): Promise<string> => {
  const races = RaceListItemArraySchema.parse(
    await api.request({
      method: 'GET',
      path: RACES_BY_YEAR_PATH,
      query: { zipcode: JUDGE_FIXTURE_RACE.zip },
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

// The 6-hourly sweepTestUsers cron is the safety net, so this returns what the
// endpoint said rather than throwing on a user it could not find: it is called
// after the arms have run, and throwing there would replace a sweep's real
// outcome with a cleanup error.
export const deleteJudgeFixture = async (
  api: FixtureApi,
  fixture: JudgeFixture,
): Promise<DeleteTestFixtureUsersResponse> =>
  DeleteTestFixtureUsersResponseSchema.parse(
    await api.request({
      method: 'DELETE',
      path: FIXTURE_USERS_PATH,
      body: { userIds: [fixture.userId] },
    }),
  )

// ---------------------------------------------------------------------------
// Reaching both arms
// ---------------------------------------------------------------------------

// The two arms are two processes in two worktrees, so nothing in memory here
// reaches both. The identifiers therefore travel the way JUDGE_DATA_VERSION
// does in sweepEnv.ts: resolved once outside the arms, exported into each
// one's environment, read back in. An arm that minted its own fixture would
// compare two organizations, and every verdict would then be an artifact of
// the fixture rather than of the branch.
export const JUDGE_FIXTURE_ENV_NAMES: Record<PlaceholderName, string> = {
  orgSlug: 'JUDGE_FIXTURE_ORG_SLUG',
  raceId: 'JUDGE_FIXTURE_RACE_ID',
  userEmail: 'JUDGE_FIXTURE_USER_EMAIL',
}

// What the plan step exports so both arms are handed the same values.
export const fixtureEnv = (
  identifiers: JudgeFixtureIdentifiers,
): Record<string, string> => ({
  [JUDGE_FIXTURE_ENV_NAMES.orgSlug]: identifiers.orgSlug,
  [JUDGE_FIXTURE_ENV_NAMES.raceId]: identifiers.raceId,
  [JUDGE_FIXTURE_ENV_NAMES.userEmail]: identifiers.userEmail,
})

// Absent rather than empty for a variable nobody set, so a placeholder whose
// value never arrived is caught by assertNoPlaceholders naming the token,
// instead of being substituted with '' and dispatched as a params object the
// agent's own minLength refuses.
export const fixtureValuesFromEnv = (
  source: NodeJS.ProcessEnv = process.env,
): PlaceholderValues => {
  const values: PlaceholderValues = {}
  for (const name of PLACEHOLDER_NAMES) {
    const value = source[JUDGE_FIXTURE_ENV_NAMES[name]]?.trim()
    if (value !== undefined && value !== '') values[name] = value
  }
  return values
}

// Which environment variable supplies which token, for the sentence a sweep
// operator reads when one of them is missing.
export const describeFixtureEnv = (): string =>
  PLACEHOLDER_NAMES.map(
    (name) =>
      `${JUDGE_PLACEHOLDERS[name]} from ${JUDGE_FIXTURE_ENV_NAMES[name]}`,
  ).join(', ')

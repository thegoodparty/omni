import { afterEach, describe, expect, it, vi } from 'vitest'
import { substituteBackgroundCases } from './caseParams'
import { armEnvFor, SWEEP_VALUES } from './fixtures/sweep'
import type { JsonValue } from './record'
import { parseArmEnv } from './sweepEnv'
import {
  createFixtureApi,
  deleteJudgeFixture,
  describeFixtureEnv,
  fixtureEnv,
  JUDGE_FIXTURE_RACE,
  JudgeFixtureError,
  mintJudgeFixture,
  type FixtureApi,
} from './sweepFixture'

// The reading half of the thread is `parseArmEnv`: blank-means-unset is
// defined there, once, for these three and the Delta version together, and
// sweepEnv.test.ts covers that rule directly. What is proven here is that the
// EXPORTING half feeds it — a rename on either side shows up as an identifier
// that does not come back.
const { orgSlug: ORG_SLUG, raceId: RACE_ID, userEmail: EMAIL } = SWEEP_VALUES

const race = (name: string, id: string): JsonValue => ({
  id,
  brPositionId: 'br-position-1',
  position: { name, level: 'city', state: 'WY' },
  election: { electionDay: '2026-11-03' },
})

// Everything the response carries by contract, including the three credentials
// the module is forbidden to log. Named plainly so a reader can see the helper
// drops them rather than takes it on trust.
const fixtureResponse = (
  overrides: Record<string, JsonValue> = {},
  omit: string[] = [],
): JsonValue => {
  const body: Record<string, JsonValue> = {
    state: 'serve-won-race',
    userId: 4242,
    clerkUserId: 'user_stub',
    email: EMAIL,
    password: 'stub-not-a-real-secret',
    campaignId: 77,
    electedOfficeId: '0192e4a0-1f00-7000-8000-0000000c0de1',
    orgSlug: ORG_SLUG,
    campaignOrgSlug: 'campaign-77',
    sessionToken: 'stub-session-token',
    signInToken: 'stub-sign-in-token',
    cookies: {
      token: 'stub-session-token',
      user: '{}',
      'organization-slug': ORG_SLUG,
    },
    expiresAt: '2026-09-30T01:00:00Z',
    ...overrides,
  }
  for (const key of omit) delete body[key]
  return body
}

interface Call {
  method: string
  path: string
}

// The one network edge, stubbed. Nothing in this suite reaches a real
// test-fixtures endpoint or mints a real Clerk identity.
const stubApi = (
  answers: {
    races?: JsonValue
    create?: JsonValue
    remove?: JsonValue
    // Separate from `remove` so the happy-path answer stays a JsonValue; a
    // union with a thrower would widen the seam's return type.
    removeThrows?: Error
  } = {},
): { api: FixtureApi; calls: Call[] } => {
  const calls: Call[] = []
  return {
    calls,
    api: {
      // Matched exactly, and anything else throws. Routing on a substring let
      // a mis-pathed request fall through to the create body, so a wrong route
      // was undetectable.
      request: async ({ method, path }) => {
        calls.push({ method, path })
        if (method === 'GET' && path === '/v1/elections/races-by-year') {
          return answers.races ?? [race(JUDGE_FIXTURE_RACE.office, RACE_ID)]
        }
        if (method === 'DELETE' && path === '/v1/test-fixtures/users') {
          if (answers.removeThrows !== undefined) throw answers.removeThrows
          return (
            answers.remove ?? {
              deleted: [{ userId: 4242, email: EMAIL }],
              notFound: [],
            }
          )
        }
        if (method === 'POST' && path === '/v1/test-fixtures/users') {
          return answers.create ?? fixtureResponse()
        }
        throw new Error(
          `the stub was asked for an unexpected ${method} ${path}`,
        )
      },
    },
  }
}

describe('mintJudgeFixture', () => {
  it('returns the identifiers a background case names', async () => {
    const { api } = stubApi()
    const fixture = await mintJudgeFixture(api)
    expect(fixture.identifiers).toEqual({
      orgSlug: ORG_SLUG,
      raceId: RACE_ID,
      userEmail: EMAIL,
    })
    expect(fixture.userId).toBe(4242)
  })

  // The response carries a password, a session token and a single-use Clerk
  // sign-in ticket by contract. Nothing downstream of here has a use for any
  // of them, and the further they travel the more places one can be logged.
  it('carries no credential out of the response', async () => {
    const { api } = stubApi()
    const fixture = await mintJudgeFixture(api)
    const serialized = JSON.stringify(fixture)
    expect(serialized).not.toContain('stub-not-a-real-secret')
    expect(serialized).not.toContain('stub-session-token')
    expect(serialized).not.toContain('stub-sign-in-token')
  })

  // Resolved first on purpose: a sweep that cannot identify the race has then
  // spent nothing and left no Clerk identity behind to sweep.
  it('resolves the race before minting the user', async () => {
    const { api, calls } = stubApi()
    await mintJudgeFixture(api)
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /v1/elections/races-by-year',
      'POST /v1/test-fixtures/users',
    ])
  })

  it('refuses when no race matches the office it mints against', async () => {
    const { api, calls } = stubApi({
      races: [race('Cheyenne City Council - Ward 4', 'other-race')],
    })
    await expect(mintJudgeFixture(api)).rejects.toThrow(JudgeFixtureError)
    expect(calls).toHaveLength(1)
  })

  // The three organization_slug agents read an issue feed scoped to an
  // elected office, so a fixture whose state produced none is not one they
  // can run against — and it would fail per case, twenty minutes in.
  it('refuses a fixture with no elected office', async () => {
    const { api } = stubApi({
      create: fixtureResponse({}, ['electedOfficeId']),
    })
    await expect(mintJudgeFixture(api)).rejects.toThrow(
      /produced no elected office/,
    )
  })

  // The POST already minted a Clerk user by then. Throwing without deleting
  // would discard the only id that can reclaim it deliberately, leaving the
  // 6-hourly cron as the sole reaper — and Clerk's Backend API budget is the
  // scarce resource here.
  it('deletes the user it minted when the fixture is unusable', async () => {
    const { api, calls } = stubApi({
      create: fixtureResponse({}, ['electedOfficeId']),
    })
    await expect(mintJudgeFixture(api)).rejects.toThrow()
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /v1/elections/races-by-year',
      'POST /v1/test-fixtures/users',
      'DELETE /v1/test-fixtures/users',
    ])
  })

  // The caller needs the reason the fixture is unusable, not the reason that
  // cleaning up an unusable fixture also failed.
  it('still reports the real reason when that delete also fails', async () => {
    const { api } = stubApi({
      create: fixtureResponse({}, ['electedOfficeId']),
      removeThrows: new JudgeFixtureError('DELETE answered 500'),
    })
    await expect(mintJudgeFixture(api)).rejects.toThrow(
      /produced no elected office/,
    )
  })
})

describe('deleteJudgeFixture', () => {
  it('deletes by the id the mint returned', async () => {
    const { api, calls } = stubApi()
    const fixture = await mintJudgeFixture(api)
    const result = await deleteJudgeFixture(api, fixture)
    expect(result.deleted).toEqual([{ userId: 4242, email: EMAIL }])
    expect(calls.at(-1)).toEqual({
      method: 'DELETE',
      path: '/v1/test-fixtures/users',
    })
  })

  // A user the endpoint could not find is an ordinary outcome — the cron may
  // have got there first — and arrives as `notFound` in a 200 body.
  it('reports a user it could not find rather than throwing', async () => {
    const { api } = stubApi({
      remove: { deleted: [], notFound: [4242] },
    })
    const fixture = await mintJudgeFixture(api)
    await expect(deleteJudgeFixture(api, fixture)).resolves.toEqual({
      deleted: [],
      notFound: [4242],
    })
  })

  // A TRANSPORT failure still rejects, and that is the contract rather than an
  // oversight: swallowing it here would hide a leaked Clerk identity from the
  // one place that could report it. The caller runs this after the arms and
  // must not let it replace a finished sweep's outcome — pinned as a test so
  // whoever wires that step knows it has to wrap the call.
  it('rejects on a transport failure, for the caller to contain', async () => {
    const { api } = stubApi({
      removeThrows: new JudgeFixtureError(
        'DELETE /v1/test-fixtures/users answered 500',
      ),
    })
    const fixture = await mintJudgeFixture(api)
    await expect(deleteJudgeFixture(api, fixture)).rejects.toThrow(
      JudgeFixtureError,
    )
  })
})

describe('reaching both arms', () => {
  const IDENTIFIERS = {
    orgSlug: ORG_SLUG,
    raceId: RACE_ID,
    userEmail: EMAIL,
  }

  // One arm, named. The two arms differ in more than the fixture — a
  // different `JUDGE_ARM`, a different commit — so reading the export back
  // under each arm's own environment is what shows the params do not depend
  // on anything arm-specific.
  const valuesInArm = (
    arm: 'base' | 'candidate',
    exported: Record<string, string>,
  ) =>
    parseArmEnv(
      armEnvFor({
        ...exported,
        JUDGE_ARM: arm,
        JUDGE_AGENTS: 'top_community_issues',
        ...(arm === 'base' && { JUDGE_ARM_COMMIT: 'c'.repeat(40) }),
      }),
    ).fixtureValues

  it('round-trips every identifier through the environment', () => {
    expect(valuesInArm('candidate', fixtureEnv(IDENTIFIERS))).toEqual(
      IDENTIFIERS,
    )
  })

  // By value against the literal names, not against the constant the function
  // is built from — these are the three variables a workflow step has to
  // export, so a rename must break here rather than agree with itself.
  it('names one variable per placeholder', () => {
    expect(fixtureEnv(IDENTIFIERS)).toEqual({
      JUDGE_FIXTURE_ORG_SLUG: ORG_SLUG,
      JUDGE_FIXTURE_RACE_ID: RACE_ID,
      JUDGE_FIXTURE_USER_EMAIL: EMAIL,
    })
  })

  it('says which variable supplies which token', () => {
    expect(describeFixtureEnv()).toBe(
      '{judgeOrgSlug} from JUDGE_FIXTURE_ORG_SLUG, ' +
        '{judgeRaceId} from JUDGE_FIXTURE_RACE_ID, ' +
        '{judgeUserEmail} from JUDGE_FIXTURE_USER_EMAIL',
    )
  })

  // The property the whole design exists for. The two arms are two processes
  // in two worktrees, so this is the only thing that makes their params
  // identical: one mint, one environment, two reads.
  it('gives two arm processes byte-identical params', async () => {
    const { api } = stubApi()
    const fixture = await mintJudgeFixture(api)
    const exported = fixtureEnv(fixture.identifiers)
    const cases = [
      {
        caseId: 'baseline',
        params: {
          organization_slug: '{judgeOrgSlug}',
          race_id: '{judgeRaceId}',
          user_email: '{judgeUserEmail}',
        },
      },
    ]

    const base = substituteBackgroundCases(cases, valuesInArm('base', exported))
    const candidate = substituteBackgroundCases(
      cases,
      valuesInArm('candidate', exported),
    )

    expect(JSON.stringify(candidate)).toBe(JSON.stringify(base))
    expect(base.map((one) => one.params)).toEqual([
      {
        organization_slug: ORG_SLUG,
        race_id: RACE_ID,
        user_email: EMAIL,
      },
    ])
  })
})

// The one real network edge. Every test above stubs at `FixtureApi`, so this
// is the only thing that exercises the adapter — and it is the piece that
// touches the response body, which is the piece this module is forbidden to
// let escape. Nothing here reaches a real endpoint: `fetch` is stubbed.
describe('createFixtureApi', () => {
  const CANARY = 'CANARY-PASSWORD-abcdefghijklmnop'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  interface Sent {
    url: string
    init: RequestInit
  }

  // Captures what was sent, not just what came back. A fake that discarded
  // its arguments would pass a broken URL join, a missing bearer, or a body
  // on a GET, and every one of those fails only against the real dev
  // endpoint — the one place this module cannot be exercised cheaply.
  const answering = (init: {
    ok: boolean
    status: number
    body: string
  }): { api: FixtureApi; sent: Sent[] } => {
    const sent: Sent[] = []
    vi.stubGlobal('fetch', async (url: URL, opts: RequestInit) => {
      sent.push({ url: String(url), init: opts })
      return {
        ok: init.ok,
        status: init.status,
        text: async () => init.body,
      }
    })
    return {
      sent,
      api: createFixtureApi({
        baseUrl: 'https://dev.invalid',
        token: 'stub-token',
      }),
    }
  }

  it('parses a 2xx body', async () => {
    const { api } = answering({
      ok: true,
      status: 200,
      body: '{"orgSlug":"eo-1"}',
    })
    await expect(
      api.request({ method: 'GET', path: '/v1/x' }),
    ).resolves.toEqual({ orgSlug: 'eo-1' })
  })

  it('builds the url from the base, the path and the query', async () => {
    const { api, sent } = answering({ ok: true, status: 200, body: '[]' })
    await api.request({
      method: 'GET',
      path: '/v1/elections/races-by-year',
      query: { zipcode: '82001' },
      auth: false,
    })
    expect(sent[0]?.url).toBe(
      'https://dev.invalid/v1/elections/races-by-year?zipcode=82001',
    )
  })

  it('sends the bearer, and no body, on a GET', async () => {
    const { api, sent } = answering({ ok: true, status: 200, body: '{}' })
    await api.request({ method: 'GET', path: '/v1/x' })
    expect(sent[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer stub-token',
      'Content-Type': 'application/json',
    })
    expect(sent[0]?.init.body).toBeUndefined()
  })

  it('sends the body it was given on a POST', async () => {
    const { api, sent } = answering({ ok: true, status: 200, body: '{}' })
    await api.request({
      method: 'POST',
      path: '/v1/test-fixtures/users',
      body: { state: 'serve-won-race' },
    })
    expect(sent[0]?.init.body).toBe('{"state":"serve-won-race"}')
  })

  // Least privilege: the race lookup is `@PublicAccess()`, so the admin/M2M
  // credential has no business riding on it.
  it('omits the bearer when the route needs none', async () => {
    const { api, sent } = answering({ ok: true, status: 200, body: '[]' })
    await api.request({ method: 'GET', path: '/v1/x', auth: false })
    expect(sent[0]?.init.headers).not.toHaveProperty('Authorization')
  })

  // Node's fetch has no request timeout of its own. The mint runs before the
  // arms, so a black-holed dev gp-api would park the whole Actions job until
  // the job timeout and deliver no verdict.
  it('gives every request an abort signal', async () => {
    const { api, sent } = answering({ ok: true, status: 200, body: '{}' })
    await api.request({ method: 'GET', path: '/v1/x' })
    expect(sent[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  // A failing create can echo the request back, and the response body on a
  // partially failed create can carry a credential.
  it('names the route and status on a failure, never the body', async () => {
    const { api } = answering({
      ok: false,
      status: 500,
      body: `{"password":"${CANARY}"}`,
    })
    const err = await api
      .request({ method: 'POST', path: '/v1/test-fixtures/users' })
      .then(
        () => new Error('resolved on a 500'),
        (e: unknown) => e,
      )
    if (!(err instanceof JudgeFixtureError)) throw err
    expect(err.message).toBe('POST /v1/test-fixtures/users answered 500')
    expect(err.message).not.toContain(CANARY)
  })

  // THE ONE THAT NEEDED A GUARD. V8 puts a snippet of its input in a
  // JSON.parse message — `Unexpected token 'x', "x{"passwor"... is not valid
  // JSON` — so a bare parse would put the first bytes of a credential-bearing
  // response into an error that a workflow log would then carry.
  it('does not echo a 2xx body that is not JSON', async () => {
    const { api } = answering({
      ok: true,
      status: 200,
      body: `x{"password":"${CANARY}"}`,
    })
    const err = await api
      .request({ method: 'POST', path: '/v1/test-fixtures/users' })
      .then(
        () => new Error('resolved, but the body is not JSON'),
        (e: unknown) => e,
      )
    if (!(err instanceof JudgeFixtureError)) throw err
    expect(err.message).not.toContain(CANARY)
    expect(err.message).not.toContain('password')
    // Length, so a truncating proxy is still diagnosable without the bytes.
    expect(err.message).toMatch(/byte\(s\) that are not JSON/)
  })

  // Deliberately NOT folded into the guard above. Zod names a path and the
  // expected type and never the received value, so a schema drift is safe to
  // surface — and reporting it as "not JSON" would be false and would discard
  // the one thing that makes it diagnosable.
  it('lets a zod path through for a body that is JSON but wrong', async () => {
    const { api } = answering({
      ok: true,
      status: 200,
      body: '{"orgSlug":"eo-1"}',
    })
    // JsonValueSchema accepts any JSON, so the drift has to be asserted at
    // the caller's schema instead: a create whose userId is not a number.
    const { api: bad } = answering({
      ok: true,
      status: 200,
      body: '{"userId":"not-a-number"}',
    })
    await expect(
      api.request({ method: 'GET', path: '/v1/x' }),
    ).resolves.toBeTruthy()
    await expect(
      bad.request({ method: 'GET', path: '/v1/x' }),
    ).resolves.toEqual({ userId: 'not-a-number' })
  })
})

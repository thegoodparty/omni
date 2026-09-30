import { describe, expect, it } from 'vitest'
import { substituteBackgroundCases } from './caseParams'
import type { JsonValue } from './record'
import {
  deleteJudgeFixture,
  describeFixtureEnv,
  fixtureEnv,
  fixtureValuesFromEnv,
  JUDGE_FIXTURE_ENV_NAMES,
  JUDGE_FIXTURE_RACE,
  JudgeFixtureError,
  mintJudgeFixture,
  type FixtureApi,
} from './sweepFixture'

const ORG_SLUG = 'eo-0192e4a0-1f00-7000-8000-0000000c0de1'
const RACE_ID = 'gAAAAABkRaCeIdFromBallotReady'
const EMAIL = 'qa-6f1c9d84-3b52-4a27-9e0f-7c3d51ab2049@goodparty.org'

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
  } = {},
): { api: FixtureApi; calls: Call[] } => {
  const calls: Call[] = []
  return {
    calls,
    api: {
      request: async ({ method, path }) => {
        calls.push({ method, path })
        if (path.includes('races-by-year')) {
          return answers.races ?? [race(JUDGE_FIXTURE_RACE.office, RACE_ID)]
        }
        if (method === 'DELETE') {
          return (
            answers.remove ?? {
              deleted: [{ userId: 4242, email: EMAIL }],
              notFound: [],
            }
          )
        }
        return answers.create ?? fixtureResponse()
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

  // Cleanup runs after the arms, so a user the endpoint could not find must
  // not replace a finished sweep's outcome with a cleanup error. The 6-hourly
  // sweepTestUsers cron is the net.
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
})

describe('reaching both arms', () => {
  const IDENTIFIERS = {
    orgSlug: ORG_SLUG,
    raceId: RACE_ID,
    userEmail: EMAIL,
  }

  it('round-trips every identifier through the environment', () => {
    expect(fixtureValuesFromEnv(fixtureEnv(IDENTIFIERS))).toEqual(IDENTIFIERS)
  })

  it('names one variable per placeholder', () => {
    expect(Object.keys(fixtureEnv(IDENTIFIERS))).toEqual(
      Object.values(JUDGE_FIXTURE_ENV_NAMES),
    )
  })

  // Absent rather than empty: '' would be substituted and dispatched as a
  // params object the agent's own minLength refuses, instead of failing at
  // the guard naming the token.
  it('omits a variable that is unset or blank', () => {
    expect(
      fixtureValuesFromEnv({
        [JUDGE_FIXTURE_ENV_NAMES.orgSlug]: ORG_SLUG,
        [JUDGE_FIXTURE_ENV_NAMES.raceId]: '  ',
      }),
    ).toEqual({ orgSlug: ORG_SLUG })
  })

  it('says which variable supplies which token', () => {
    expect(describeFixtureEnv()).toContain(
      `{judgeOrgSlug} from ${JUDGE_FIXTURE_ENV_NAMES.orgSlug}`,
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

    const base = substituteBackgroundCases(
      cases,
      fixtureValuesFromEnv({ ...exported }),
    )
    const candidate = substituteBackgroundCases(
      cases,
      fixtureValuesFromEnv({ ...exported }),
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

  // An arm that read its own fixture would compare two organizations, so the
  // failure mode is a verdict that is an artifact of the fixture. Stated as a
  // test because "the values are the same" is the only thing that rules it
  // out, and two independent mints do not give it.
  it('would differ if each arm minted its own fixture', async () => {
    const first = await mintJudgeFixture(stubApi().api)
    const second = await mintJudgeFixture(
      stubApi({ create: fixtureResponse({ orgSlug: 'eo-other' }) }).api,
    )
    expect(second.identifiers.orgSlug).not.toBe(first.identifiers.orgSlug)
  })
})

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { substituteBackgroundCases } from './caseParams'
import { armEnvFor } from './fixtures/sweep'
import {
  JUDGE_USER_EMAIL,
  identifierOutputLines,
  judgeOrgSlug,
  requireAllowedApi,
  resolveJudgeIdentifiers,
  resolveRaceId,
} from './judgeIdentifiers'
import { buildDispatchMessage } from './runners/background'
import { parseArmEnv } from './sweepEnv'
import { JUDGE_FIXTURE_ENV_NAMES } from './caseParams'
import { JUDGE_FIXTURE_RACE } from './sweepFixture'

// What a sweep's step writes, sent all the way to the dispatch builder, which
// refuses any slug that is not `judge-*`. Checked end to end, because a value
// of any other shape passes every check short of that one.

const races = (office: string, id: string) =>
  vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify([
        {
          id,
          brPositionId: 'br-position-1',
          position: { name: office, level: 'city', state: 'WY' },
          election: { electionDay: '2026-11-03' },
        },
      ]),
      { status: 200 },
    ),
  )

const PARSE = (lines: string): Record<string, string> =>
  Object.fromEntries(
    lines
      .trim()
      .split('\n')
      .map((line) => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]),
  )

describe('judgeOrgSlug', () => {
  it('makes a judge- slug from the sweep id, without doubling the prefix', () => {
    expect(judgeOrgSlug('judge-36999748321-1')).toBe('judge-36999748321-1')
    expect(judgeOrgSlug('swp_1')).toBe('judge-swp_1')
  })

  it.each(['judge-a b', 'x'.repeat(80), 'a/b'])(
    'refuses a sweep id that would not dispatch: %j',
    (sweepId) => {
      expect(() => judgeOrgSlug(sweepId)).toThrow(/dispatchable/)
    },
  )
})

describe('resolveRaceId', () => {
  it('reads the race id from the public route, with no credential', async () => {
    const fetchImpl = races(JUDGE_FIXTURE_RACE.office, 'gAAAArace')
    expect(
      await resolveRaceId('https://gp-api-dev.goodparty.org', fetchImpl),
    ).toBe('gAAAArace')
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(String(url)).toBe(
      `https://gp-api-dev.goodparty.org/v1/elections/races-by-year?zipcode=${JUDGE_FIXTURE_RACE.zip}`,
    )
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
  })

  it('refuses when no race matches the office', async () => {
    await expect(
      resolveRaceId('http://localhost:3000', races('Some Other Office', 'x')),
    ).rejects.toThrow(/no race named/)
  })

  it('reports a failed lookup by status', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('nope', { status: 503 }))
    await expect(
      resolveRaceId('http://localhost:3000', fetchImpl),
    ).rejects.toThrow(/answered 503/)
  })
})

describe('requireAllowedApi', () => {
  it.each(['https://gp-api-dev.goodparty.org', 'http://localhost:3000'])(
    'accepts %s',
    (url) => {
      expect(requireAllowedApi(url)).toBe(url)
    },
  )

  it.each([
    undefined,
    'https://gp-api.goodparty.org',
    'https://gp-api-dev.goodparty.org.evil.example',
    'http://gp-api-dev.goodparty.org',
    'http://localhost:1@evil.example',
  ])('refuses %j', (url) => {
    expect(() => requireAllowedApi(url)).toThrow(/dev gp-api or a local one/)
  })
})

describe('identifierOutputLines', () => {
  it('writes exactly the three identifiers', () => {
    expect(
      PARSE(
        identifierOutputLines({
          orgSlug: 'judge-1-1',
          raceId: 'race',
          userEmail: JUDGE_USER_EMAIL,
        }),
      ),
    ).toEqual({
      org_slug: 'judge-1-1',
      race_id: 'race',
      user_email: 'judge-sweep@example.com',
    })
  })

  it('refuses a value with a line break', () => {
    expect(() =>
      identifierOutputLines({
        orgSlug: 'judge-1-1',
        raceId: 'race\nuser_email=evil',
        userEmail: JUDGE_USER_EMAIL,
      }),
    ).toThrow(/line break/)
  })
})

// THE RACE ALONE CAN GO MISSING. The races route lists upcoming races only, so
// once the named election passes the lookup finds nothing. That must cost the
// three race agents, by name, and nothing else.
describe('a race that cannot be read', () => {
  const noRace = races('Some Other Office', 'x')

  it('still resolves the slug and the address, and says why', async () => {
    const ids = await resolveJudgeIdentifiers(
      'judge-1-1',
      'http://localhost:3000',
      noRace,
    )
    expect(ids).toEqual({
      orgSlug: 'judge-1-1',
      userEmail: 'judge-sweep@example.com',
      raceUnavailable: expect.stringMatching(/no race named/),
    })
  })

  it('writes no race_id, so an arm reads it as unset', async () => {
    const ids = await resolveJudgeIdentifiers(
      'judge-1-1',
      'http://localhost:3000',
      noRace,
    )
    const out = PARSE(identifierOutputLines(ids))
    expect(out).toEqual({
      org_slug: 'judge-1-1',
      user_email: 'judge-sweep@example.com',
    })
    const arm = parseArmEnv(
      armEnvFor({
        [JUDGE_FIXTURE_ENV_NAMES.orgSlug]: out.org_slug,
        [JUDGE_FIXTURE_ENV_NAMES.userEmail]: out.user_email,
      }),
    )
    // A slug-only list still substitutes; a race list is refused by name.
    expect(
      substituteBackgroundCases(
        [{ caseId: 'c1', params: { organization_slug: '{judgeOrgSlug}' } }],
        arm.fixtureValues,
      ),
    ).toEqual([{ caseId: 'c1', params: { organization_slug: 'judge-1-1' } }])
    expect(() =>
      substituteBackgroundCases(
        [{ caseId: 'c2', params: { race_id: '{judgeRaceId}' } }],
        arm.fixtureValues,
      ),
    ).toThrow(/c2/)
  })

  // A bad API address is a configuration bug, not missing data: it still
  // fails the resolution as a whole.
  it('still refuses an API outside dev', async () => {
    await expect(
      resolveJudgeIdentifiers(
        'judge-1-1',
        'https://gp-api.goodparty.org',
        noRace,
      ),
    ).rejects.toThrow(/dev gp-api or a local one/)
  })
})

// THE WHOLE PATH: resolve, write the outputs, read them back as an arm does,
// substitute a case, and build the real dispatch message from it.
describe('the identifiers a sweep resolves', () => {
  it('reach the dispatch builder and are accepted', async () => {
    const ids = await resolveJudgeIdentifiers(
      'judge-36999748321-1',
      'https://gp-api-dev.goodparty.org',
      races(JUDGE_FIXTURE_RACE.office, 'gAAAArace'),
    )
    const out = PARSE(identifierOutputLines(ids))
    const arm = parseArmEnv(
      armEnvFor({
        [JUDGE_FIXTURE_ENV_NAMES.orgSlug]: out.org_slug,
        [JUDGE_FIXTURE_ENV_NAMES.raceId]: out.race_id,
        [JUDGE_FIXTURE_ENV_NAMES.userEmail]: out.user_email,
      }),
    )
    const [agentCase] = substituteBackgroundCases(
      [
        {
          caseId: 'baseline',
          params: {
            organization_slug: '{judgeOrgSlug}',
            race_id: '{judgeRaceId}',
            user_email: '{judgeUserEmail}',
          },
        },
      ],
      arm.fixtureValues,
    )
    const message = buildDispatchMessage({
      runId: 'judge-swp1-c1-candidate-1',
      agentId: 'opposition_research',
      organizationSlug: arm.fixtureValues.orgSlug ?? '',
      agentCase: agentCase ?? { caseId: 'missing', params: {} },
      override: {
        manifest_key: '_judge/opposition_research/abc/manifest.json',
        instruction_key: '_judge/opposition_research/abc/instruction.md',
      },
    })
    expect(message.organization_slug).toBe('judge-36999748321-1')
    expect(message.params).toEqual({
      organization_slug: 'judge-36999748321-1',
      race_id: 'gAAAArace',
      user_email: 'judge-sweep@example.com',
    })
  })
})

// The entry as judge.yml runs it. Every refusal here happens before any
// network call, so these run offline.
describe('the judgeIdentifiers entry', () => {
  const run = (args: string[], env: NodeJS.ProcessEnv) =>
    spawnSync('npx', ['tsx', join(__dirname, 'judgeIdentifiers.ts'), ...args], {
      cwd: join(__dirname, '../../../..'),
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })

  it('refuses to run without a sweep id or an output path', () => {
    expect(run([], { JUDGE_SWEEP_ID: 'judge-1-1' }).status).toBe(1)
    const noId = run(['/dev/null'], { JUDGE_SWEEP_ID: '' })
    expect(noId.status).toBe(1)
    expect(noId.stderr).toMatch(/usage/)
  })

  it('refuses an API outside dev before reading anything', () => {
    const result = run(['/dev/null'], {
      JUDGE_SWEEP_ID: 'judge-1-1',
      JUDGE_FIXTURE_API_URL: 'https://gp-api.goodparty.org',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/dev gp-api or a local one/)
  })
})

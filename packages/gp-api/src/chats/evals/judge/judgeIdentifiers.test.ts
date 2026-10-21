import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { substituteBackgroundCases } from './caseParams'
import { armEnvFor } from './fixtures/sweep'
import { JUDGE_USER_EMAIL } from './judgeFixtureIdentity'
import {
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

  // The dispatch's own limit: 64 characters, prefix included.
  it('accepts a slug of exactly 64 characters and refuses 65', () => {
    expect(judgeOrgSlug('x'.repeat(58))).toHaveLength(64)
    expect(() => judgeOrgSlug('x'.repeat(59))).toThrow(/dispatchable/)
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

  // The exact office and the first of it, not a near name or a later one.
  it('takes the first race whose office is exactly the named one', async () => {
    const body = [
      ['Cheyenne City Council - Ward 2', 'wrong-ward'],
      [JUDGE_FIXTURE_RACE.office, 'right'],
      [JUDGE_FIXTURE_RACE.office, 'later'],
    ].map(([office, id]) => ({
      id,
      brPositionId: 'br-position-1',
      position: { name: office, level: 'city', state: 'WY' },
      election: { electionDay: '2026-11-03' },
    }))
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
    expect(await resolveRaceId('http://localhost:3000', fetchImpl)).toBe(
      'right',
    )
  })

  // Nothing but Accept: no cookie, no key, no credential of any kind, and a
  // timeout so a hung lookup cannot hold the sweep until the job limit.
  it('sends no credential and gives up on a hung lookup', async () => {
    const fetchImpl = races(JUDGE_FIXTURE_RACE.office, 'r')
    await resolveRaceId('http://localhost:3000', fetchImpl)
    const [, init] = fetchImpl.mock.calls[0] ?? []
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
      accept: 'application/json',
    })
    expect(init?.credentials).toBeUndefined()
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  // The right office, a numeric id, nothing else: navigable enough that only
  // the schema refuses it, so a cast in its place would hand back `1`.
  it('refuses a body that is not a race list', async () => {
    const body = JSON.stringify([
      { id: 1, position: { name: JUDGE_FIXTURE_RACE.office } },
    ])
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { status: 200 }))
    await expect(
      resolveRaceId('http://localhost:3000', fetchImpl),
    ).rejects.toThrow()
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
// The constants the race is named by. Pinned as literals: every other test
// reads them back from themselves, so a drift would agree with itself.
describe('the race the case lists name', () => {
  it('is Cheyenne City Council, Ward 1, at 82001', () => {
    expect(JUDGE_FIXTURE_RACE).toEqual({
      zip: '82001',
      office: 'Cheyenne City Council - Ward 1',
    })
  })
})

describe('resolveJudgeIdentifiers', () => {
  it('makes the slug from the sweep id it is given', async () => {
    vi.stubEnv('JUDGE_SWEEP_ID', 'judge-somewhere-else')
    const ids = await resolveJudgeIdentifiers(
      'judge-777-2',
      'http://localhost:3000',
      races(JUDGE_FIXTURE_RACE.office, 'r'),
    )
    vi.unstubAllEnvs()
    expect(ids.orgSlug).toBe('judge-777-2')
  })
})

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

  // THE SUCCESS PATH, AS WRITTEN: the real entry against a local stand-in for
  // the races route. Every other test stubs the step's `npx`, so only this
  // one sees which file the entry writes and what it puts there.
  it('writes the three outputs to the file it was given, and only there', async () => {
    const seen: { url?: string; headers?: Record<string, unknown> } = {}
    const server = createServer((req, res) => {
      seen.url = req.url
      seen.headers = req.headers
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify([
          {
            id: 'gAAAArace',
            brPositionId: 'br-position-1',
            position: {
              name: JUDGE_FIXTURE_RACE.office,
              level: 'city',
              state: 'WY',
            },
            election: { electionDay: '2026-11-03' },
          },
        ]),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const out = join(mkdtempSync(join(tmpdir(), 'judge-ids-')), 'out')
    const result = await new Promise<{ code: number | null; stdout: string }>(
      (resolve) => {
        const child = spawn(
          'npx',
          ['tsx', join(__dirname, 'judgeIdentifiers.ts'), out],
          {
            cwd: join(__dirname, '../../../..'),
            env: {
              ...process.env,
              JUDGE_SWEEP_ID: 'judge-555-1',
              JUDGE_FIXTURE_API_URL: `http://localhost:${port}`,
            },
          },
        )
        let stdout = ''
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
        })
        child.on('close', (code) => resolve({ code, stdout }))
      },
    )
    server.close()
    expect(result.code).toBe(0)
    expect(readFileSync(out, 'utf8')).toBe(
      identifierOutputLines({
        orgSlug: 'judge-555-1',
        raceId: 'gAAAArace',
        userEmail: JUDGE_USER_EMAIL,
      }),
    )
    expect(result.stdout).not.toContain('org_slug=')
    expect(seen.url).toBe(
      `/v1/elections/races-by-year?zipcode=${JUDGE_FIXTURE_RACE.zip}`,
    )
    expect(seen.headers?.authorization).toBeUndefined()
    expect(seen.headers?.cookie).toBeUndefined()
  }, 60_000)

  it('refuses an API outside dev before reading anything', () => {
    const result = run(['/dev/null'], {
      JUDGE_SWEEP_ID: 'judge-1-1',
      JUDGE_FIXTURE_API_URL: 'https://gp-api.goodparty.org',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/dev gp-api or a local one/)
  })
})

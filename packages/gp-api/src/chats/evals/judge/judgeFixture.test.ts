import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { JUDGE_FIXTURE_ENV_NAMES } from './caseParams'
import { armEnvFor } from './fixtures/sweep'
import {
  fixtureOutputLines,
  mintM2MToken,
  parseUserId,
  requireAllowedApi,
  runFixtureCommand,
} from './judgeFixture'
import type { JsonValue } from './record'
import {
  JUDGE_FIXTURE_RACE,
  type FixtureApi,
  type JudgeFixture,
} from './sweepFixture'
import { parseArmEnv } from './sweepEnv'

// THE FIXTURE CROSSES A SEAM: minted in one step, carried through
// $GITHUB_OUTPUT, read back by both arms' parseArmEnv. And it carries a test
// user's credentials on the way in, which must never reach the way out.

// Distinct from every default, so a round trip that ignored its input could
// not arrive at the right answer by accident.
const FIXTURE: JudgeFixture = {
  identifiers: {
    orgSlug: 'eo-judge-fixture-7f3a',
    raceId: 'br-race-91c2',
    userEmail: 'qa-5b1e@goodparty.org',
  },
  userId: 4821,
}

const PARSE = (lines: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of lines.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1)
  }
  return out
}

describe('fixtureOutputLines', () => {
  // EXACTLY these four keys. The mint response carries the user's password, a
  // session token and a single-use Clerk sign-in ticket, and $GITHUB_OUTPUT
  // reaches every later step and can surface in logs — so the shape is pinned
  // whole, not "contains the identifiers".
  it('writes the three identifiers and the id, and nothing else', () => {
    expect(PARSE(fixtureOutputLines(FIXTURE))).toEqual({
      org_slug: 'eo-judge-fixture-7f3a',
      race_id: 'br-race-91c2',
      user_email: 'qa-5b1e@goodparty.org',
      user_id: '4821',
    })
  })

  // A fixture object that ALSO carries the credentials, the way the raw mint
  // response does. A later change that spread the response into the output
  // would put them in the job log; this is what would catch it.
  it('never writes a credential, even when the object carries one', () => {
    const withSecrets: JudgeFixture & {
      password: string
      sessionToken: string
      signInTicket: string
    } = {
      ...FIXTURE,
      password: 'correct-horse-battery',
      sessionToken: 'sess_live_abc',
      signInTicket: 'tkt_single_use_xyz',
    }
    const written = fixtureOutputLines(withSecrets)
    for (const secret of [
      'correct-horse-battery',
      'sess_live_abc',
      'tkt_single_use_xyz',
    ]) {
      expect(written).not.toContain(secret)
    }
  })

  // A line break would end the value's own line in $GITHUB_OUTPUT and start
  // another output of the value's choosing.
  it.each([
    ['orgSlug', 'judge-x\nuser_id=1'],
    ['raceId', 'race\r\nx=y'],
    ['userEmail', 'qa@goodparty.org\norg_slug=evil'],
  ] as const)('refuses a %s with a line break', (field, value) => {
    expect(() =>
      fixtureOutputLines({
        ...FIXTURE,
        identifiers: { ...FIXTURE.identifiers, [field]: value },
      }),
    ).toThrow(/contains a line break/)
  })

  // The round trip to the arms, through the real parser and the real env
  // names — the user id stays behind for the delete step and is not an arm
  // input.
  it('reaches both arms as the fixture values they substitute', () => {
    const out = PARSE(fixtureOutputLines(FIXTURE))
    const arm = parseArmEnv(
      armEnvFor({
        [JUDGE_FIXTURE_ENV_NAMES.orgSlug]: out.org_slug,
        [JUDGE_FIXTURE_ENV_NAMES.raceId]: out.race_id,
        [JUDGE_FIXTURE_ENV_NAMES.userEmail]: out.user_email,
      }),
    )
    expect(arm.fixtureValues).toEqual(FIXTURE.identifiers)
  })
})

describe('requireAllowedApi', () => {
  it.each(['https://gp-api-dev.goodparty.org', 'http://localhost:3000'])(
    'accepts %s',
    (url) => {
      expect(requireAllowedApi(url)).toBe(url)
    },
  )

  // Anchored at both ends: a suffix, a lookalike host or a downgrade to http
  // would each send a bearer that can mint users somewhere nobody checked.
  it.each([
    undefined,
    '',
    'https://gp-api.goodparty.org',
    'https://gp-api-dev.goodparty.org.evil.example',
    'https://evil.example/https://gp-api-dev.goodparty.org',
    'http://gp-api-dev.goodparty.org',
    'https://gp-api-dev.goodparty.org/',
    // The localhost arm is anchored too: a userinfo `@` sends the request to
    // the host after it, over plain http.
    'http://localhost:1@evil.example',
    'http://localhost',
    'http://localhost:3000/x',
  ])('refuses %j', (url) => {
    expect(() => requireAllowedApi(url)).toThrow(/dev gp-api or a local one/)
  })
})

describe('parseUserId', () => {
  it('reads the id the mint step wrote', () => {
    expect(parseUserId('4821')).toBe(4821)
  })

  // A delete aimed at the wrong id reclaims someone else's fixture, so
  // nothing a loose coercion would accept gets through.
  it.each([undefined, '', '0', '-1', '1e3', '4.2', ' 42', 'abc'])(
    'refuses %j',
    (raw) => {
      expect(() => parseUserId(raw)).toThrow(/positive whole number/)
    },
  )
})

describe('mintM2MToken', () => {
  const respond = (status: number, body: string) =>
    vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }))

  it('trades the machine secret for a token', async () => {
    const fetchImpl = respond(200, JSON.stringify({ token: 'mt_judge_1' }))
    expect(await mintM2MToken('ak_machine', fetchImpl)).toBe('mt_judge_1')
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('https://api.clerk.com/v1/m2m_tokens')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer ak_machine',
    )
    expect(new Headers(init?.headers).get('Content-Type')).toBe(
      'application/json',
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      seconds_until_expiration: 600,
    })
  })

  // The status, never Clerk's body: this runs in a log a public repository's
  // readers can see, one hop from a secret.
  it('reports a refusal by status without echoing what Clerk said', async () => {
    const fetchImpl = respond(401, 'machine secret ak_machine is revoked')
    // Caught and read, not `rejects.not.toThrow(/x/)` — that form passes
    // vacuously, so a "must not say X" check has to read the message itself.
    const message = await mintM2MToken('ak_machine', fetchImpl).then(
      () => 'resolved',
      (err: Error) => err.message,
    )
    expect(message).toMatch(/HTTP 401/)
    expect(message).not.toContain('ak_machine')
  })

  it('refuses a response with no token', async () => {
    await expect(
      mintM2MToken('ak_machine', respond(200, '{}')),
    ).rejects.toThrow()
  })
})

// THE REAL ENTRY, as judge.yml runs it. Every refusal here happens before any
// network call — the secret and the API are checked first — so these run
// offline and could never mint anything.
describe('the judgeFixture entry', () => {
  const run = (args: string[], env: NodeJS.ProcessEnv) =>
    spawnSync('npx', ['tsx', join(__dirname, 'judgeFixture.ts'), ...args], {
      cwd: join(__dirname, '../../../..'),
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })

  it('refuses to start without the machine secret', () => {
    const result = run(['mint', '/dev/null'], {
      JUDGE_CLERK_MACHINE_SECRET: '',
      JUDGE_FIXTURE_API_URL: 'https://gp-api-dev.goodparty.org',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/JUDGE_CLERK_MACHINE_SECRET is not set/)
  })

  it('refuses an API outside dev before sending anything', () => {
    const result = run(['mint', '/dev/null'], {
      JUDGE_CLERK_MACHINE_SECRET: 'ak_never_sent',
      JUDGE_FIXTURE_API_URL: 'https://gp-api.goodparty.org',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/dev gp-api or a local one/)
    expect(result.stderr).not.toContain('ak_never_sent')
  })
})

// THE ENTRY'S OWN WIRING, with the two network edges stubbed: which file a
// mint writes, that only the identifiers reach it, what each command logs,
// and that every refusal that needs no network happens before the token.
describe('runFixtureCommand', () => {
  const ENV = {
    JUDGE_CLERK_MACHINE_SECRET: 'ak_machine',
    JUDGE_FIXTURE_API_URL: 'https://gp-api-dev.goodparty.org',
  }
  const CREDENTIALS = ['pw-never-written', 'sess-never-written', 'tkt-never']

  const harness = (removed: { notFound: number[] } = { notFound: [] }) => {
    const calls: { method: string; path: string; body?: JsonValue }[] = []
    const logged: string[] = []
    const api: FixtureApi = {
      request: async ({ method, path, body }): Promise<JsonValue> => {
        calls.push({ method, path, ...(body !== undefined && { body }) })
        if (method === 'GET' && path === '/v1/elections/races-by-year') {
          return [
            {
              id: 'br-race-91c2',
              brPositionId: 'br-position-1',
              position: {
                name: JUDGE_FIXTURE_RACE.office,
                level: 'city',
                state: 'WY',
              },
              election: { electionDay: '2026-11-03' },
            },
          ]
        }
        if (method === 'POST' && path === '/v1/test-fixtures/users') {
          return {
            state: 'serve-won-race',
            userId: 4821,
            clerkUserId: 'user_stub',
            email: 'qa-5b1e@goodparty.org',
            password: CREDENTIALS[0] ?? '',
            electedOfficeId: '0192e4a0-1f00-7000-8000-0000000c0de1',
            orgSlug: 'eo-judge-fixture-7f3a',
            sessionToken: CREDENTIALS[1] ?? '',
            signInToken: CREDENTIALS[2] ?? '',
            cookies: {
              token: CREDENTIALS[1] ?? '',
              user: '{}',
              'organization-slug': 'eo-judge-fixture-7f3a',
            },
            expiresAt: '2026-09-30T01:00:00Z',
          }
        }
        if (method === 'DELETE' && path === '/v1/test-fixtures/users') {
          return removed.notFound.length > 0
            ? { deleted: [], notFound: removed.notFound }
            : { deleted: [{ userId: 77, email: 'x' }], notFound: [] }
        }
        throw new Error(`unexpected ${method} ${path}`)
      },
    }
    const mintToken = vi.fn(async (secret: string) => `mt_for_${secret}`)
    const createApi = vi.fn(() => api)
    const deps = { mintToken, createApi, log: (l: string) => logged.push(l) }
    return { calls, logged, mintToken, createApi, deps }
  }

  it('mints into the named file, identifiers only', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'judge-fixture-')), 'out')
    const h = harness()
    await runFixtureCommand(['mint', out], ENV, h.deps)
    const written = readFileSync(out, 'utf8')
    expect(written).toBe(fixtureOutputLines(FIXTURE))
    for (const secret of CREDENTIALS) {
      expect(written).not.toContain(secret)
      expect(h.logged.join('\n')).not.toContain(secret)
    }
    expect(h.mintToken).toHaveBeenCalledWith('ak_machine')
    expect(h.createApi).toHaveBeenCalledWith({
      baseUrl: 'https://gp-api-dev.goodparty.org',
      token: 'mt_for_ak_machine',
    })
    expect(h.logged).toEqual([
      'minted fixture organization eo-judge-fixture-7f3a',
    ])
  })

  it('deletes the id it was given, and says so', async () => {
    const h = harness()
    await runFixtureCommand(['delete', '77'], ENV, h.deps)
    expect(h.calls).toEqual([
      {
        method: 'DELETE',
        path: '/v1/test-fixtures/users',
        body: { userIds: [77] },
      },
    ])
    expect(h.logged).toEqual(['deleted fixture user 77'])
  })

  it('does not claim a delete the endpoint did not make', async () => {
    const h = harness({ notFound: [77] })
    await runFixtureCommand(['delete', '77'], ENV, h.deps)
    expect(h.logged).toEqual(['fixture user 77 was already gone'])
  })

  // Before the token: a bad id or a bad command must not spend a Clerk call,
  // and must not reach an endpoint with a credential in hand.
  it.each<[string, string[], NodeJS.ProcessEnv, RegExp]>([
    ['a malformed id', ['delete', 'abc'], ENV, /positive whole number/],
    ['an unknown command', ['mint-all', '/tmp/x'], ENV, /usage/],
    ['a missing argument', ['mint'], ENV, /usage/],
    [
      'no secret',
      ['mint', '/tmp/x'],
      { ...ENV, JUDGE_CLERK_MACHINE_SECRET: '' },
      /JUDGE_CLERK_MACHINE_SECRET is not set/,
    ],
    [
      'a prod API',
      ['mint', '/tmp/x'],
      { ...ENV, JUDGE_FIXTURE_API_URL: 'https://gp-api.goodparty.org' },
      /dev gp-api or a local one/,
    ],
  ])('refuses %s before minting a token', async (_, argv, env, message) => {
    const h = harness()
    const error = await runFixtureCommand(argv, env, h.deps).then(
      () => 'resolved',
      (err: Error) => err.message,
    )
    expect(error).toMatch(message)
    expect(h.mintToken).not.toHaveBeenCalled()
    expect(h.createApi).not.toHaveBeenCalled()
  })
})

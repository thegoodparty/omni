import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { JUDGE_FIXTURE_ENV_NAMES } from './caseParams'
import { armEnvFor } from './fixtures/sweep'
import {
  fixtureOutputLines,
  mintM2MToken,
  parseUserId,
  requireAllowedApi,
} from './judgeFixture'
import { type JudgeFixture } from './sweepFixture'
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

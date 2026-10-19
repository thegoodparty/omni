import { readFileSync } from 'node:fs'
import path from 'node:path'
import { addSeconds, formatISO } from 'date-fns'
import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  createJudgeSession,
  JUDGE_CLERK_ENV,
  JudgeClerkSessionError,
  mintJudgeSession,
  parseJudgeClerkMintConfig,
  parseJudgeSessionFromEnv,
  sessionOutputLines,
  type ClerkSessionApi,
  type MintedSession,
  type SessionMinter,
} from './judgeClerkSession'

const SECRET_KEY = 'sk_test_AbCdEf0123456789'
const USER_ID = 'user_2zJudgeAbCdEf'
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJqdWRnZSJ9.c2lnbmF0dXJl'

const mintEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  [JUDGE_CLERK_ENV.secretKey]: SECRET_KEY,
  [JUDGE_CLERK_ENV.userId]: USER_ID,
  ...overrides,
})

describe('parseJudgeClerkMintConfig', () => {
  it('reads a complete configuration', () => {
    expect(parseJudgeClerkMintConfig(mintEnv())).toEqual({
      secretKey: SECRET_KEY,
      userId: USER_ID,
      ttlSeconds: 4 * 60 * 60,
    })
  })

  it('takes a TTL the caller set', () => {
    const config = parseJudgeClerkMintConfig(
      mintEnv({ [JUDGE_CLERK_ENV.ttlSeconds]: '7200' }),
    )
    expect(config.ttlSeconds).toBe(7200)
  })

  // THE ONE THAT HAS TO READ WELL. There is no judge Clerk user yet, so this
  // is the first thing anyone wiring the step will see.
  it('names the user id and says the account is made by hand', () => {
    expect(() =>
      parseJudgeClerkMintConfig({ [JUDGE_CLERK_ENV.secretKey]: SECRET_KEY }),
    ).toThrow(
      new RegExp(`${JUDGE_CLERK_ENV.userId} is not set.*dev instance`, 's'),
    )
  })

  it.each([JUDGE_CLERK_ENV.secretKey, JUDGE_CLERK_ENV.userId])(
    'names %s when it is blank',
    (name) => {
      expect(() => parseJudgeClerkMintConfig(mintEnv({ [name]: '' }))).toThrow(
        `${name} is not set`,
      )
    },
  )

  it.each([
    [JUDGE_CLERK_ENV.secretKey, 'pk_test_AbCdEf0123456789'],
    [JUDGE_CLERK_ENV.userId, 'judge-sweep@example.com'],
    [JUDGE_CLERK_ENV.ttlSeconds, 'an hour'],
    [JUDGE_CLERK_ENV.ttlSeconds, '30'],
    [JUDGE_CLERK_ENV.ttlSeconds, '86400'],
  ])('names %s when it is %o', (name, value) => {
    expect(() => parseJudgeClerkMintConfig(mintEnv({ [name]: value }))).toThrow(
      new RegExp(`^the judge cannot mint a Clerk session: ${name} `),
    )
  })

  // A malformed secret in a workflow log is the failure this whole piece
  // exists to avoid, so the sentence may name the variable and never its
  // value.
  it('never repeats the value it rejected', () => {
    const bad = 'sk_test_but_with_punctuation!'
    try {
      parseJudgeClerkMintConfig(mintEnv({ [JUDGE_CLERK_ENV.secretKey]: bad }))
      expect.unreachable('a malformed secret key should not parse')
    } catch (err) {
      expect((err as Error).message).not.toContain(bad)
    }
  })
})

const fakeClerk = (
  jwt = JWT,
): ClerkSessionApi & {
  createSession: ReturnType<typeof vi.fn>
  getToken: ReturnType<typeof vi.fn>
} => {
  const createSession = vi.fn().mockResolvedValue({ id: 'sess_1' })
  const getToken = vi.fn().mockResolvedValue({ jwt })
  return { sessions: { createSession, getToken }, createSession, getToken }
}

describe('mintJudgeSession', () => {
  // The two calls headless-user.ts makes, for the reason its comment gives: a
  // browser-minted token lives 60 seconds and dies partway through any long
  // flow.
  it('creates a session then asks it for a token with the TTL', async () => {
    const clerk = fakeClerk()
    const at = new Date('2026-10-18T12:00:00.000Z')
    const session = await mintJudgeSession(
      { secretKey: SECRET_KEY, userId: USER_ID, ttlSeconds: 3600 },
      clerk,
      () => at,
    )
    expect(clerk.createSession).toHaveBeenCalledWith({ userId: USER_ID })
    expect(clerk.getToken).toHaveBeenCalledWith('sess_1', undefined, 3600)
    expect(session).toEqual({ jwt: JWT, expiresAt: addSeconds(at, 3600) })
  })
})

const silent = (): void => undefined

// A clock the test moves by hand, so expiry is a fact rather than a wait.
const clock = (start: string) => {
  let at = new Date(start)
  return {
    now: (): Date => at,
    advance: (seconds: number): void => {
      at = addSeconds(at, seconds)
    },
  }
}

const minter = (
  expiresInSeconds: number,
  now: () => Date,
): { mint: Mock<SessionMinter>; jwts: string[] } => {
  const jwts: string[] = []
  const mint = vi.fn<SessionMinter>(async (): Promise<MintedSession> => {
    const jwt = `${JWT}${jwts.length}`
    jwts.push(jwt)
    return { jwt, expiresAt: addSeconds(now(), expiresInSeconds) }
  })
  return { mint, jwts }
}

describe('createJudgeSession', () => {
  it('mints once and reuses the token while it is good', async () => {
    const time = clock('2026-10-18T12:00:00.000Z')
    const { mint } = minter(3600, time.now)
    const session = createJudgeSession({ mint, now: time.now, log: silent })

    const first = await session.token()
    time.advance(600)
    expect(await session.token()).toBe(first)
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('re-mints inside the margin rather than handing out a dying token', async () => {
    const time = clock('2026-10-18T12:00:00.000Z')
    const { mint, jwts } = minter(3600, time.now)
    const session = createJudgeSession({ mint, now: time.now, log: silent })

    const first = await session.token()
    // 3540s in, four minutes of life left, inside the five-minute margin.
    time.advance(3540)
    const second = await session.token()
    expect(second).not.toBe(first)
    expect(second).toBe(jwts[1])
    expect(mint).toHaveBeenCalledTimes(2)
  })

  it('starts from a token the mint step handed it', async () => {
    const time = clock('2026-10-18T12:00:00.000Z')
    const { mint } = minter(3600, time.now)
    const session = createJudgeSession({
      mint,
      initial: { jwt: JWT, expiresAt: addSeconds(time.now(), 3600) },
      now: time.now,
      log: silent,
    })
    expect(await session.token()).toBe(JWT)
    expect(mint).not.toHaveBeenCalled()
  })

  it('re-mints after a 401 on a token that had aged', async () => {
    const time = clock('2026-10-18T12:00:00.000Z')
    const { mint, jwts } = minter(3600, time.now)
    const lines: string[] = []
    const session = createJudgeSession({
      mint,
      now: time.now,
      log: (line) => lines.push(line),
    })

    await session.token()
    time.advance(300)
    expect(await session.refused()).toBe(jwts[1])
    expect(mint).toHaveBeenCalledTimes(2)
    expect(lines.at(-1)).toContain('re-minted')
    expect(lines.at(-1)).toContain('401')
  })

  // THE POINT OF THE AGE RULE. A token the target refuses seconds after Clerk
  // issued it was not refused for being old, and a retry loop here would turn
  // a judge user with no role into a sweep that mints forever and never gets
  // in.
  it('surfaces a 401 on a fresh token instead of retrying', async () => {
    const time = clock('2026-10-18T12:00:00.000Z')
    const { mint } = minter(3600, time.now)
    const session = createJudgeSession({ mint, now: time.now, log: silent })

    await session.token()
    time.advance(5)
    await expect(session.refused()).rejects.toThrow(JudgeClerkSessionError)
    await expect(session.refused()).rejects.toThrow('is not expiry')
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('stops after one re-mint when the second token is refused too', async () => {
    const time = clock('2026-10-18T12:00:00.000Z')
    const { mint } = minter(3600, time.now)
    const session = createJudgeSession({ mint, now: time.now, log: silent })

    await session.token()
    time.advance(300)
    await session.refused()
    await expect(session.refused()).rejects.toThrow('is not expiry')
    expect(mint).toHaveBeenCalledTimes(2)
  })

  // A re-mint is a log line and a permissions problem is an exception, so
  // neither can be mistaken for the other in a job log.
  it('logs a re-mint and throws an auth failure', async () => {
    const time = clock('2026-10-18T12:00:00.000Z')
    const { mint } = minter(3600, time.now)
    const lines: string[] = []
    const session = createJudgeSession({
      mint,
      now: time.now,
      log: (line) => lines.push(line),
    })

    await session.token()
    time.advance(300)
    await session.refused()
    expect(lines.filter((line) => line.includes('re-minted'))).toHaveLength(1)
    expect(lines.some((line) => line.includes('is not expiry'))).toBe(false)
  })

  it('never writes a token to the log', async () => {
    const time = clock('2026-10-18T12:00:00.000Z')
    const { mint, jwts } = minter(3600, time.now)
    const lines: string[] = []
    const session = createJudgeSession({
      mint,
      now: time.now,
      log: (line) => lines.push(line),
    })

    await session.token()
    time.advance(3540)
    await session.token()
    expect(jwts).toHaveLength(2)
    for (const jwt of jwts) {
      expect(lines.join('\n')).not.toContain(jwt)
    }
  })

  // The arm holds no Clerk secret, on purpose. When its token runs out it has
  // to say which step mints and which knob to turn, not fail inside an HTTP
  // client.
  it('explains itself when it expires with no minter', async () => {
    const time = clock('2026-10-18T12:00:00.000Z')
    const session = createJudgeSession({
      initial: { jwt: JWT, expiresAt: addSeconds(time.now(), 3600) },
      now: time.now,
      log: silent,
    })
    time.advance(3600)
    await expect(session.token()).rejects.toThrow(
      new RegExp(`checkout of main.*${JUDGE_CLERK_ENV.ttlSeconds}`, 's'),
    )
  })

  it('refuses a 401 with no minter rather than looping', async () => {
    const time = clock('2026-10-18T12:00:00.000Z')
    const session = createJudgeSession({
      initial: { jwt: JWT, expiresAt: addSeconds(time.now(), 3600) },
      now: time.now,
      log: silent,
    })
    time.advance(300)
    await expect(session.refused()).rejects.toThrow(JudgeClerkSessionError)
  })
})

describe('parseJudgeSessionFromEnv', () => {
  const expiresAt = new Date('2026-10-18T16:00:00.000Z')

  it('reads the token and the expiry the mint step published', () => {
    expect(
      parseJudgeSessionFromEnv({
        [JUDGE_CLERK_ENV.sessionToken]: JWT,
        [JUDGE_CLERK_ENV.sessionExpiresAt]: formatISO(expiresAt),
      }),
    ).toEqual({ jwt: JWT, expiresAt })
  })

  it.each([JUDGE_CLERK_ENV.sessionToken, JUDGE_CLERK_ENV.sessionExpiresAt])(
    'names %s when it is missing',
    (name) => {
      const env: NodeJS.ProcessEnv = {
        [JUDGE_CLERK_ENV.sessionToken]: JWT,
        [JUDGE_CLERK_ENV.sessionExpiresAt]: formatISO(expiresAt),
      }
      delete env[name]
      expect(() => parseJudgeSessionFromEnv(env)).toThrow(`${name} is not set`)
    },
  )

  it('does not echo a malformed token', () => {
    const bad = 'eyJhbGciOiJSUzI1NiJ9-but-not-a-jwt'
    try {
      parseJudgeSessionFromEnv({
        [JUDGE_CLERK_ENV.sessionToken]: bad,
        [JUDGE_CLERK_ENV.sessionExpiresAt]: formatISO(expiresAt),
      })
      expect.unreachable('a malformed token should not parse')
    } catch (err) {
      expect((err as Error).message).not.toContain(bad)
    }
  })
})

describe('sessionOutputLines', () => {
  const session: MintedSession = {
    jwt: JWT,
    expiresAt: new Date('2026-10-18T16:00:00.000Z'),
  }

  it('writes exactly the two keys the workflow step reads', () => {
    expect(sessionOutputLines(session)).toBe(
      `judge_session_token=${JWT}\n` +
        `judge_session_expires_at=${formatISO(session.expiresAt)}\n`,
    )
  })

  // In $GITHUB_OUTPUT a line break would end the token's line and start an
  // output of the writer's choosing.
  it('refuses a token carrying a line break', () => {
    expect(() =>
      sessionOutputLines({ ...session, jwt: `${JWT}\nfoo=bar` }),
    ).toThrow('contains a line break')
  })
})

// Every judge variable is in the README's configuration table, the way
// ARM_AWS_ENV's three are, because the table is where someone wiring a step
// goes to find out what to pass.
describe('the README documents the Clerk variables', () => {
  const readme = readFileSync(path.resolve(__dirname, 'README.md'), 'utf8')
  it.each(Object.values(JUDGE_CLERK_ENV))('names %s', (name) => {
    expect(readme).toMatch(new RegExp(`^\\| .*\`${name}\``, 'm'))
  })
})

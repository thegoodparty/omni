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
  resolveJudgeClerkUserId,
  JUDGE_CLERK_EMAIL,
  type ClerkSessionApi,
  type ClerkUserApi,
  type MintedSession,
  type SessionMinter,
} from './judgeClerkSession'
import { JUDGE_FIXTURE } from './judgeFixtureIdentity'

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

  // An absent id is the ordinary case now: the mint step resolves the
  // account by email rather than waiting on someone to make one.
  // THE ONE THAT WOULD HAVE SAVED THE FIRST LIVE SWEEP. The workflow passes
  // `${{ vars.JUDGE_CLERK_USER_ID }}`, and an Actions variable that is not
  // set expands to an empty string rather than vanishing, so `.optional()`
  // alone never sees `undefined`.
  it.each(['', '   '])('reads %o as no user id rather than a bad one', (v) => {
    expect(
      parseJudgeClerkMintConfig({
        [JUDGE_CLERK_ENV.secretKey]: SECRET_KEY,
        [JUDGE_CLERK_ENV.userId]: v,
      }),
    ).toEqual({ secretKey: SECRET_KEY, ttlSeconds: 4 * 60 * 60 })
  })

  it('still refuses a user id that is set but malformed', () => {
    expect(() =>
      parseJudgeClerkMintConfig({
        [JUDGE_CLERK_ENV.secretKey]: SECRET_KEY,
        [JUDGE_CLERK_ENV.userId]: 'judge-sweep@example.com',
      }),
    ).toThrow(JUDGE_CLERK_ENV.userId)
  })

  it('accepts a configuration with no user id', () => {
    expect(
      parseJudgeClerkMintConfig({ [JUDGE_CLERK_ENV.secretKey]: SECRET_KEY }),
    ).toEqual({ secretKey: SECRET_KEY, ttlSeconds: 4 * 60 * 60 })
  })

  it.each([JUDGE_CLERK_ENV.secretKey])('names %s when it is blank', (name) => {
    expect(() => parseJudgeClerkMintConfig(mintEnv({ [name]: '' }))).toThrow(
      `${name} is not set`,
    )
  })

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

const userApi = (
  found: { id: string }[],
  created: { id: string } = { id: 'user_2zCreatedJudge' },
): ClerkUserApi & { getUserList: Mock; createUser: Mock } => {
  const getUserList = vi.fn().mockResolvedValue({ data: found })
  const createUser = vi.fn().mockResolvedValue(created)
  return { users: { getUserList, createUser }, getUserList, createUser }
}

describe('resolveJudgeClerkUserId', () => {
  const config = { secretKey: SECRET_KEY, ttlSeconds: 3600 }

  it('uses a configured id without asking Clerk at all', async () => {
    const clerk = userApi([])

    await expect(
      resolveJudgeClerkUserId({ ...config, userId: USER_ID }, clerk, vi.fn()),
    ).resolves.toBe(USER_ID)
    expect(clerk.getUserList).not.toHaveBeenCalled()
    expect(clerk.createUser).not.toHaveBeenCalled()
  })

  // The account is shared by every concurrent sweep on purpose. Creating one
  // per run would burn the backend API budget every preview shares.
  it('reuses the existing account rather than making a second', async () => {
    const clerk = userApi([{ id: USER_ID }])

    await expect(resolveJudgeClerkUserId(config, clerk, vi.fn())).resolves.toBe(
      USER_ID,
    )
    expect(clerk.getUserList).toHaveBeenCalledWith({
      emailAddress: [JUDGE_CLERK_EMAIL],
      limit: 1,
    })
    expect(clerk.createUser).not.toHaveBeenCalled()
  })

  it('creates the account once when it is not there', async () => {
    const clerk = userApi([])

    await expect(resolveJudgeClerkUserId(config, clerk, vi.fn())).resolves.toBe(
      'user_2zCreatedJudge',
    )
    expect(clerk.createUser).toHaveBeenCalledTimes(1)
    expect(clerk.createUser.mock.calls[0]?.[0]).toMatchObject({
      emailAddress: [JUDGE_CLERK_EMAIL],
      skipPasswordChecks: true,
    })
  })

  // The guard in src/judge compares the caller's email to this exact value
  // and answers 404 on anything else, so an account under another address
  // would authenticate and then be unable to read its own telemetry.
  // The guard in src/judge compares the caller's email to this same
  // constant, so an account under any other address would authenticate and
  // then be unable to read its own telemetry.
  it('creates it under the address the access guard checks', () => {
    expect(JUDGE_CLERK_EMAIL).toBe('judge-chat@example.com')
  })

  // Not the background fixture's address, which already belongs to a gp-api
  // row under a placeholder clerk id. User.email is unique, so an account
  // under it cannot be provisioned and every request 401s.
  it('is not the background fixture address', () => {
    expect(JUDGE_CLERK_EMAIL).not.toBe(JUDGE_FIXTURE.email)
  })

  it('never puts the generated password in a log line', async () => {
    const lines: string[] = []
    const clerk = userApi([])

    await resolveJudgeClerkUserId(config, clerk, (line) => lines.push(line))

    const password = clerk.createUser.mock.calls[0]?.[0].password as string
    expect(password).toBeTruthy()
    expect(lines.join('\n')).not.toContain(password)
  })
})

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

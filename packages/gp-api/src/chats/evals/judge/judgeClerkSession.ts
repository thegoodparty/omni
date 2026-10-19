import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createClerkClient } from '@clerk/backend'
import {
  addSeconds,
  differenceInMilliseconds,
  differenceInSeconds,
  formatISO,
  isValid,
  parseISO,
} from 'date-fns'
import { z } from 'zod'
import { JUDGE_FIXTURE } from './judgeFixtureIdentity'

// A REAL SIGNED-IN USER FOR THE CHAT ARMS, minted outside them.
//
// `SessionGuard` refuses an agent token on anything but the MCP controller,
// and the fixture identity in judgeFixtureIdentity.ts names no Clerk user at
// all: the broker signs its own token, so nothing on the background path ever
// reaches Clerk. A chat arm driving a DEPLOYED gp-api over HTTP has no such
// seam. It needs a session token Clerk itself issued, for a user gp-api can
// find.
//
// WHY THIS IS A PIECE OF ITS OWN. The Clerk secret key mints a session for
// ANY user in the dev instance. It must never sit in a step that runs the
// pull request's own code — that is the exposure the previews migration
// exists to remove, and putting Clerk in an arm step would recreate it with a
// different vendor. So the mint runs in its own step, from a checkout of
// `main`, and the only thing handed onward is the short-lived JWT. An arm
// builds its session from that token and holds no secret, which is why `mint`
// below is optional and its absence is a sentence rather than a crash.
//
// Browser-minted Clerk tokens live 60 seconds, which is why the webapp's E2E
// helper mints from the backend SDK instead (see `mintApiToken` in
// gp-webapp/e2e-tests/tests/utils/headless-user.ts). The same two calls are
// here, against a TTL sized for a sweep rather than for one test.

// Under JUDGE_ names for the reason modelKey.ts and awsCredentials.ts use
// them: vitest applies `.env.test` over the process environment, and
// `.env.test` defines CLERK_SECRET_KEY as the stub `sk_...`. A real key
// exported under the SDK's own name would be replaced before any test line
// ran, which is how the first live sweep spent two arms on `invalid
// x-api-key`.
export const JUDGE_CLERK_ENV = {
  // MINT STEP ONLY, and never in a step that runs branch code.
  secretKey: 'JUDGE_CLERK_SECRET_KEY',
  userId: 'JUDGE_CLERK_USER_ID',
  ttlSeconds: 'JUDGE_CLERK_TTL_SECONDS',
  // What the arms read. These two are all a chat arm ever gets.
  sessionToken: 'JUDGE_CLERK_SESSION_TOKEN',
  sessionExpiresAt: 'JUDGE_CLERK_SESSION_EXPIRES_AT',
} as const

export class JudgeClerkSessionError extends Error {}

// Long enough to outlast a sweep rather than a test: the E2E helper's hour is
// sized for one Playwright spec, and a full sweep is two arms an hour or more
// apart. The floor is above the re-mint margin below, so a token can never be
// born already due for replacement.
const TTL_DEFAULT_SECONDS = 4 * 60 * 60
const TTL_MIN_SECONDS = 10 * 60
const TTL_MAX_SECONDS = 12 * 60 * 60

// How much life a token must have left to be handed out. The slowest call an
// arm makes is a chat turn, which streams for minutes; a token given out with
// less than this left would expire mid-stream and the turn would be lost
// rather than retried.
const REMINT_MARGIN_MS = 5 * 60 * 1000

// A refusal this soon after a mint is not expiry. Re-minting then would hide
// a judge user with no role, or a Clerk instance the deployed target does not
// trust, behind a loop that mints forever and never gets in.
const FRESH_TOKEN_MS = 60 * 1000

const NON_EMPTY = z.string().trim().min(1)

const SecretKeySchema = NON_EMPTY.regex(
  /^sk_(?:test|live)_[A-Za-z0-9]+$/,
  // Phrased to read after the variable's name, the way sweepEnv.ts assembles
  // its sentences.
  'is not a Clerk backend secret key (sk_test_… or sk_live_…)',
)

const UserIdSchema = NON_EMPTY.regex(
  /^user_[A-Za-z0-9]+$/,
  'is not a Clerk user id, which is the `user_…` value Clerk shows for the ' +
    'account',
)

const TtlSchema = z
  .string()
  .optional()
  .transform((value) => value?.trim() ?? '')
  .refine(
    (value) => value === '' || /^\d+$/.test(value),
    'is not a whole number of seconds',
  )
  .transform((value) =>
    value === '' ? TTL_DEFAULT_SECONDS : Number.parseInt(value, 10),
  )
  .refine(
    (seconds) => seconds >= TTL_MIN_SECONDS && seconds <= TTL_MAX_SECONDS,
    `must be between ${TTL_MIN_SECONDS} and ${TTL_MAX_SECONDS} seconds`,
  )

// Shape only. The value is never echoed, here or in any error below: a
// sentence that quoted a malformed token would put most of a real one into a
// log the moment someone truncated it by hand.
const JwtSchema = NON_EMPTY.regex(
  /^[\w-]+\.[\w-]+\.[\w-]+$/,
  'is not a JWT, so it is not a token the mint step produced',
)

const ExpiresAtSchema = NON_EMPTY.transform((value) => parseISO(value)).refine(
  (value) => isValid(value),
  'is not an ISO 8601 timestamp',
)

const MintEnvSchema = z.object({
  [JUDGE_CLERK_ENV.secretKey]: SecretKeySchema,
  // Optional, and usually absent. Set it to pin an existing account; leave
  // it unset and the mint step finds or creates the judge's own by email.
  //
  // BLANK COUNTS AS UNSET, which `.optional()` alone does not deliver and
  // which cost the first live HTTP sweep. The workflow passes
  // `${{ vars.JUDGE_CLERK_USER_ID }}`, and an Actions variable that does not
  // exist expands to an empty string rather than vanishing, so the value
  // arrives as `''`. That is not `undefined`, so it reached NON_EMPTY and the
  // regex and produced two issues about one field: "JUDGE_CLERK_USER_ID is
  // not set, and JUDGE_CLERK_USER_ID is not set". sweepEnv.ts's
  // BLANK_IS_UNSET exists for this exact hazard; this is the same shape.
  [JUDGE_CLERK_ENV.userId]: z
    .string()
    .transform((value) => value.trim())
    .transform((value) => (value === '' ? undefined : value))
    .optional()
    .pipe(UserIdSchema.optional()),
  [JUDGE_CLERK_ENV.ttlSeconds]: TtlSchema,
})

const ArmSessionSchema = z.object({
  [JUDGE_CLERK_ENV.sessionToken]: JwtSchema,
  [JUDGE_CLERK_ENV.sessionExpiresAt]: ExpiresAtSchema,
})

// One sentence naming what is missing or wrong, because zod's own report is a
// tree and a tree in a workflow log is what makes someone re-run a job to
// read it again. "Not set" is decided from the environment rather than from
// the issue: an absent variable and a malformed one need different sentences
// and zod reports both as an invalid type.
const asSentence = (
  issues: readonly z.core.$ZodIssue[],
  source: NodeJS.ProcessEnv,
): string =>
  issues
    .map((issue) => {
      const name = String(issue.path[0] ?? '(root)')
      const value = source[name]
      return value === undefined || value.trim() === ''
        ? `${name} is not set`
        : `${name} ${issue.message}`
    })
    .join(', and ')

export interface JudgeClerkMintConfig {
  secretKey: string
  // Absent means "resolve it", not "fail": see resolveJudgeClerkUserId.
  userId?: string
  ttlSeconds: number
}

// The judge's account is not created by hand. JUDGE_CLERK_USER_ID is an
// override for pinning an existing one; left unset, the mint step finds the
// account by email and creates it if it is not there, which is what
// e2e-tests/tests/utils/api-registration.ts does through the same backend
// SDK. A hand-made account was the earlier design and it made every sweep
// wait on a person.
export const parseJudgeClerkMintConfig = (
  source: NodeJS.ProcessEnv = process.env,
): JudgeClerkMintConfig => {
  const parsed = MintEnvSchema.safeParse(source)
  if (!parsed.success) {
    throw new JudgeClerkSessionError(
      'the judge cannot mint a Clerk session: ' +
        asSentence(parsed.error.issues, source),
    )
  }
  return {
    secretKey: parsed.data[JUDGE_CLERK_ENV.secretKey],
    userId: parsed.data[JUDGE_CLERK_ENV.userId],
    ttlSeconds: parsed.data[JUDGE_CLERK_ENV.ttlSeconds],
  }
}

export interface MintedSession {
  jwt: string
  expiresAt: Date
}

// Just enough of the backend SDK to mint, so a test can hand in a fake
// without a Clerk client and without a network.
export interface ClerkSessionApi {
  sessions: {
    createSession(params: { userId: string }): Promise<{ id: string }>
    getToken(
      sessionId: string,
      template?: string,
      expiresInSeconds?: number,
    ): Promise<{ jwt: string }>
  }
}

// Just enough of the backend SDK to find or create the account, kept
// separate from ClerkSessionApi so a test that only mints needs neither.
export interface ClerkUserApi {
  users: {
    getUserList(params: {
      emailAddress: string[]
      limit?: number
    }): Promise<{ data: { id: string }[] }>
    createUser(params: {
      emailAddress: string[]
      password?: string
      firstName?: string
      lastName?: string
      skipPasswordChecks?: boolean
    }): Promise<{ id: string }>
  }
}

// The address is not a choice. src/judge's access guard compares the caller's
// email to JUDGE_FIXTURE_EMAIL and answers 404 on anything else, so an account
// under a different address authenticates and then cannot read its own
// telemetry. Both constants are asserted equal in judgeTelemetry.util.test.ts.
export const JUDGE_CLERK_EMAIL = JUDGE_FIXTURE.email

// Find, then create. Idempotent on purpose: the mint step runs once per sweep
// against a Clerk instance shared by every preview and every CI shard, whose
// backend API is capped near 100 requests per 10 seconds, and
// e2e-tests/AGENTS.md records what exhausting it looks like — Clerk answers
// 429, gp-api turns the failed lookup into a bare 401, and the failure reads
// like an auth bug rather than a budget one. One lookup and, once ever, one
// create.
//
// The account is deliberately NOT swept. users.service.ts reaps e2e users
// after three hours and fixture users matching `qa-<uuid>@goodparty.org`
// after twenty-four; this address matches neither, so the judge keeps one
// stable account instead of minting a new identity per sweep.
export const resolveJudgeClerkUserId = async (
  config: JudgeClerkMintConfig,
  client: ClerkUserApi,
  log: (line: string) => void = logToStderr,
): Promise<string> => {
  if (config.userId !== undefined) return config.userId

  const { data: found } = await client.users.getUserList({
    emailAddress: [JUDGE_CLERK_EMAIL],
    limit: 1,
  })
  const existing = found[0]
  if (existing) return existing.id

  // Never signed in with, because the session is minted from the backend, so
  // this is generated and dropped rather than stored anywhere.
  const created = await client.users.createUser({
    emailAddress: [JUDGE_CLERK_EMAIL],
    password: `judge-${randomUUID()}!`,
    firstName: 'Universal',
    lastName: 'Judge',
    skipPasswordChecks: true,
  })
  log(
    `${LOG_PREFIX} created the judge's Clerk account for ` +
      `${JUDGE_CLERK_EMAIL} as ${created.id}`,
  )
  return created.id
}

export type SessionMinter = () => Promise<MintedSession>

// Clerk answers with the JWT and nothing about its lifetime, so the expiry is
// computed from the TTL we asked for. Erring early is the safe direction: a
// token believed to expire sooner than it does is re-minted once too often,
// and one believed to last longer dies in the middle of a turn.
// Takes a config whose user id is already resolved, so the type carries the
// ordering rather than a comment: resolveJudgeClerkUserId runs first.
export type ResolvedJudgeClerkMintConfig = JudgeClerkMintConfig & {
  userId: string
}

export const mintJudgeSession = async (
  config: ResolvedJudgeClerkMintConfig,
  client: ClerkSessionApi,
  now: () => Date = () => new Date(),
): Promise<MintedSession> => {
  const requestedAt = now()
  const session = await client.sessions.createSession({
    userId: config.userId,
  })
  const { jwt } = await client.sessions.getToken(
    session.id,
    undefined,
    config.ttlSeconds,
  )
  return { jwt, expiresAt: addSeconds(requestedAt, config.ttlSeconds) }
}

export interface JudgeSession {
  // A token with at least the re-mint margin of life left.
  token(): Promise<string>
  // Called after the target answered 401 for the token `token()` last handed
  // out. Returns a fresh one, or throws when the refusal cannot be expiry.
  refused(): Promise<string>
}

export interface JudgeSessionOptions {
  // Absent on an arm, by design: the arm holds no Clerk secret, so it cannot
  // mint and must say so rather than fail somewhere in an HTTP client.
  mint?: SessionMinter
  // What the mint step handed this process, if anything.
  initial?: MintedSession
  now?: () => Date
  log?: (line: string) => void
}

const logToStderr = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

// One stable prefix on every line this writes, so `grep` separates a routine
// re-mint from the thrown failure below. A re-mint is a log line and a real
// permissions problem is an exception: they are never the same shape, and
// neither carries the token.
const LOG_PREFIX = '[judge-clerk]'

export const createJudgeSession = ({
  mint,
  initial,
  now = () => new Date(),
  log = logToStderr,
}: JudgeSessionOptions): JudgeSession => {
  let current = initial
  let mintedAt = initial === undefined ? undefined : now()
  let mints = initial === undefined ? 0 : 1

  const renew = async (why: string): Promise<string> => {
    if (mint === undefined) {
      throw new JudgeClerkSessionError(
        `the judge's Clerk session token cannot be used (${why}) and this ` +
          'process holds no Clerk secret to mint another, which is ' +
          'deliberate: the mint step runs from a checkout of main so no ' +
          'step running branch code ever holds one. Raise ' +
          `${JUDGE_CLERK_ENV.ttlSeconds} on that step and sweep again.`,
      )
    }
    const next = await mint()
    current = next
    mintedAt = now()
    mints += 1
    log(
      `${LOG_PREFIX} ${mints === 1 ? 'minted' : 're-minted'} the judge's ` +
        `session token (${why}); good for another ` +
        `${differenceInSeconds(next.expiresAt, mintedAt)}s`,
    )
    return next.jwt
  }

  return {
    token: async (): Promise<string> => {
      if (current === undefined) return renew('none has been minted yet')
      return differenceInMilliseconds(current.expiresAt, now()) >
        REMINT_MARGIN_MS
        ? current.jwt
        : renew('it is within the re-mint margin of expiry')
    },
    refused: async (): Promise<string> => {
      const age =
        mintedAt === undefined
          ? undefined
          : differenceInMilliseconds(now(), mintedAt)
      if (age !== undefined && age < FRESH_TOKEN_MS) {
        throw new JudgeClerkSessionError(
          'the target refused a Clerk session token minted ' +
            `${Math.round(age / 1000)}s ago, so the refusal is not expiry ` +
            'and another mint would not fix it. Check that the judge Clerk ' +
            'user exists in the instance the target trusts, that gp-api has ' +
            'a user row for it, and that the route allows that user.',
        )
      }
      return renew('the target answered 401')
    },
  }
}

// What an arm builds its session from: the token and the expiry the mint step
// published, and nothing else.
export const parseJudgeSessionFromEnv = (
  source: NodeJS.ProcessEnv = process.env,
): MintedSession => {
  const parsed = ArmSessionSchema.safeParse(source)
  if (!parsed.success) {
    throw new JudgeClerkSessionError(
      'this arm has no judge Clerk session to call chat routes with: ' +
        asSentence(parsed.error.issues, source),
    )
  }
  return {
    jwt: parsed.data[JUDGE_CLERK_ENV.sessionToken],
    expiresAt: parsed.data[JUDGE_CLERK_ENV.sessionExpiresAt],
  }
}

// AT MOST TWO LINES for the caller to mask and copy into $GITHUB_OUTPUT. A
// value with a line break is refused: in that file it would end its own line
// and start an output of its choosing.
export const sessionOutputLines = (session: MintedSession): string => {
  const values = {
    judge_session_token: session.jwt,
    judge_session_expires_at: formatISO(session.expiresAt),
  }
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) {
      throw new JudgeClerkSessionError(
        `the judge's ${key} contains a line break`,
      )
    }
  }
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('')
}

// gp-api is CommonJS, so `require.main` is the house pattern.
//
//   JUDGE_CLERK_SECRET_KEY=... JUDGE_CLERK_USER_ID=... \
//     judgeClerkSession.ts <out>
//
// Writes the token to <out> and NOWHERE ELSE — not stdout, not stderr, not an
// error message. The caller registers it with `::add-mask::` before copying
// it into $GITHUB_OUTPUT, the way verify-vercel-registrar-token.yml does, so
// the one place the value ever reaches a log stream is the line Actions
// redacts at source. Exits non-zero with one sentence on any failure.
if (require.main === module) {
  const [out] = process.argv.slice(2)
  const run = async (): Promise<void> => {
    if (!out) {
      throw new JudgeClerkSessionError(
        `usage: ${JUDGE_CLERK_ENV.secretKey}=<key> ` +
          `[${JUDGE_CLERK_ENV.userId}=<id>] judgeClerkSession.ts ` +
          '<path to write the token to>',
      )
    }
    const config = parseJudgeClerkMintConfig()
    const clerk = createClerkClient({ secretKey: config.secretKey })
    const userId = await resolveJudgeClerkUserId(config, clerk)
    const session = await mintJudgeSession({ ...config, userId }, clerk)
    writeFileSync(out, sessionOutputLines(session), { mode: 0o600 })
    process.stderr.write(
      `${LOG_PREFIX} minted a session for ${userId}, good until ` +
        `${formatISO(session.expiresAt)}\n`,
    )
  }
  run().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  })
}

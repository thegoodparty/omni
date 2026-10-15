import { randomUUID } from 'node:crypto'
import { createClerkClient } from '@clerk/backend'
import { z } from 'zod'
import { throttleRequestsWithRetry } from '@/vendors/clerk/util/throttleRequestsWithRetry.util'

// ONE THROWAWAY ACCOUNT PER (CASE, ATTEMPT), made on a deployed gp-api the
// way a person would make one: a Clerk user, a backend-minted session token,
// then gp-api's own user routes. Nothing here writes to a database, and the
// app has no judge-specific route, header or hook.
//
// The dev Clerk instance serves dev and every PR preview, so one secret makes
// an account either arm can use. The pattern is gp-webapp's headless test
// user (e2e-tests/tests/utils/headless-user.ts).

export const JUDGE_CLERK_SECRET_ENV = 'JUDGE_CLERK_SECRET_KEY'

export class JudgeAccountError extends Error {}

// What a chat case is driven with.
export interface JudgeAccount {
  token: string
  organizationSlug: string
}

export interface ClerkPort {
  createUser: (email: string, password: string) => Promise<string>
  mintToken: (clerkUserId: string) => Promise<string>
  deleteUser: (clerkUserId: string) => Promise<void>
}

// An hour, so a token minted at the start of a case outlives every turn of it.
const TOKEN_TTL_SECONDS = 60 * 60

// The instance allows 100 Backend API requests per 10s, shared with every e2e
// run and with gp-api's own lookups. A fifth of it is the judge's.
export const clerkPortFrom = (secretKey: string): ClerkPort => {
  const clerk = createClerkClient({ secretKey })
  const throttled = throttleRequestsWithRetry({
    rateLimit: 100,
    windowMs: 10_000,
    safetyFactor: 0.2,
    label: 'judge-clerk',
  })
  return {
    createUser: async (email, password) => {
      const user = await throttled(() =>
        clerk.users.createUser({
          emailAddress: [email],
          password,
          firstName: 'Judge',
          lastName: 'Fixture',
          skipPasswordChecks: true,
        }),
      )
      return user.id
    },
    mintToken: async (clerkUserId) => {
      const session = await throttled(() =>
        clerk.sessions.createSession({ userId: clerkUserId }),
      )
      const { jwt } = await throttled(() =>
        clerk.sessions.getToken(session.id, undefined, TOKEN_TTL_SECONDS),
      )
      return jwt
    },
    deleteUser: async (clerkUserId) => {
      await throttled(() => clerk.users.deleteUser(clerkUserId))
    },
  }
}

// gp-api's test-user rule (users/util/users.util.ts), so the account reads as
// test data wherever gp-api tells test users apart.
export const judgeAccountEmail = (): string =>
  `qa-${randomUUID()}@goodparty.org`

const REQUEST_TIMEOUT_MS = 60_000

// A cold preview answers 502-504 until its task is healthy, and gp-api
// answers a bare 401 for a new Clerk user while the shared Clerk budget is
// spent. Both pass; only the first call of an account meets them.
const RETRIABLE = new Set([401, 502, 503, 504])
const FIRST_CALL_ATTEMPTS = 7

interface Call {
  method: 'GET' | 'POST'
  path: string
  body?: object
  organizationSlug?: string
}

export interface AccountHttp {
  baseUrl: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const send = async (
  http: AccountHttp,
  token: string,
  call: Call,
): Promise<Response> =>
  (http.fetchImpl ?? fetch)(`${http.baseUrl}${call.path}`, {
    method: call.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(call.body !== undefined && { 'content-type': 'application/json' }),
      ...(call.organizationSlug !== undefined && {
        'x-organization-slug': call.organizationSlug,
      }),
    },
    ...(call.body !== undefined && { body: JSON.stringify(call.body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

const refusal = async (call: Call, response: Response): Promise<never> => {
  const text = (await response.text()).slice(0, 200)
  throw new JudgeAccountError(
    `${call.method} ${call.path.split('?')[0]} returned ${response.status}` +
      (text === '' ? '' : `: ${text}`),
  )
}

const request = async <T>(
  http: AccountHttp,
  token: string,
  call: Call,
  schema: z.ZodType<T>,
): Promise<T> => {
  const response = await send(http, token, call)
  if (!response.ok) return refusal(call, response)
  return schema.parse(await response.json())
}

const firstRequest = async (
  http: AccountHttp,
  token: string,
  call: Call,
): Promise<void> => {
  const sleep =
    http.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  for (let attempt = 1; ; attempt++) {
    const response = await send(http, token, call).catch(() => undefined)
    if (response?.ok) return
    const last = attempt === FIRST_CALL_ATTEMPTS
    if (response !== undefined && (last || !RETRIABLE.has(response.status))) {
      return refusal(call, response)
    }
    if (last) {
      throw new JudgeAccountError(
        `${call.method} ${call.path} got no response from ${http.baseUrl}`,
      )
    }
    await sleep(Math.min(1_000 * 2 ** (attempt - 1), 20_000))
  }
}

const ElectedOfficeSchema = z.object({
  id: z.string(),
  organizationSlug: z.string(),
})

// The chat agents whose state is set up here. The other chat agents are
// blocked in agents.ts, so an arm never reaches this with one of them.
const CHAT_AGENT_SCOPES: Record<string, string> = {
  chief_of_staff: 'chief_of_staff',
}

export const chatScopeFor = (agentId: string): string => {
  const scope = CHAT_AGENT_SCOPES[agentId]
  if (scope === undefined) {
    throw new Error(
      `"${agentId}" is not a chat scope the runner can drive; the ` +
        `driven scopes are ${Object.keys(CHAT_AGENT_SCOPES).join(', ')}`,
    )
  }
  return scope
}

// The scope's state, set up through the user routes and nothing else: an
// elected office with a custom position. No BallotReady position, so no
// district resolves and creating the office dispatches no background agent.
export const setUpScope = async (
  http: AccountHttp,
  token: string,
  agentId: string,
): Promise<Omit<JudgeAccount, 'token'>> => {
  chatScopeFor(agentId)
  const office = await request(
    http,
    token,
    {
      method: 'POST',
      path: '/v1/elected-office',
      body: { customPositionName: 'Council Member' },
    },
    ElectedOfficeSchema,
  )
  return { organizationSlug: office.organizationSlug }
}

export interface JudgeAccounts {
  provision: (agentId: string) => Promise<JudgeAccount>
  // Best effort, and never throws: a Clerk user left behind is a throwaway
  // test account, not a reason to fail an arm whose records are written.
  deleteAll: () => Promise<string[]>
}

export const judgeAccounts = (
  http: AccountHttp,
  clerk: ClerkPort,
): JudgeAccounts => {
  const created: string[] = []
  return {
    provision: async (agentId) => {
      chatScopeFor(agentId)
      const clerkUserId = await clerk.createUser(
        judgeAccountEmail(),
        `Judge${randomUUID()}!`,
      )
      created.push(clerkUserId)
      const token = await clerk.mintToken(clerkUserId)
      await firstRequest(http, token, { method: 'GET', path: '/v1/users/me' })
      return { token, ...(await setUpScope(http, token, agentId)) }
    },
    deleteAll: async () => {
      const failed: string[] = []
      for (const clerkUserId of created.splice(0)) {
        try {
          await clerk.deleteUser(clerkUserId)
        } catch (err) {
          failed.push(
            `${clerkUserId}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
      return failed
    },
  }
}

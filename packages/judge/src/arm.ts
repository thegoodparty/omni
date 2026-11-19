import {
  createTestUser,
  vercelBypassHeaders,
  type TestUser,
} from '@goodparty_org/test-users'
import axios from 'axios'
import { randomUUID } from 'node:crypto'
import { probeTimeoutMs, resolveApiRoot } from './apiRoot'
import type {
  EvalApi,
  EvalContext,
  PairwiseAgentEvalSuite,
  SuiteProfile,
} from './suite'
import { runAgentThroughRoutes } from './runAgent'

// One arm of one case attempt: a brand-new test user on that arm's base URL, the
// org its bootstrap created, and the two helpers a suite gets.
//
// Every run gets a new user, and so a new org — all three attempts on each side,
// so each starts from a clean slate. The three attempts of one case share the
// suite's profile, so only the identity is new and the attempts stay comparable.

export type ArmName = 'base' | 'candidate'

export type ArmUser = Pick<TestUser, 'user' | 'orgSlug' | 'clerkUserId'>

export type CreateArmContextOptions = {
  arm: ArmName
  baseUrl: string
  profile: SuiteProfile
  mode: PairwiseAgentEvalSuite<unknown>['mode']
  // How a user is created. Swapped in tests.
  provisionUser?: typeof createTestUser
  // How an agent is driven. Swapped in tests.
  runAgent?: typeof runAgentThroughRoutes
  pollIntervalMs?: number
  timeoutMs?: number
}

export type ArmContext = {
  ctx: EvalContext
  user: ArmUser
}

const toEvalApi = (user: TestUser): EvalApi => ({
  get: async <T>(
    path: string,
    config?: { params?: Record<string, unknown> },
  ) => {
    const { data } = await user.client.get<T>(path, config)
    return data
  },
  post: async <T>(path: string, body?: unknown) => {
    const { data } = await user.client.post<T>(path, body)
    return data
  },
  put: async <T>(path: string, body?: unknown) => {
    const { data } = await user.client.put<T>(path, body)
    return data
  },
})

// `x-organization-slug` on every request, so a route that reads the org sees
// the one bootstrap created rather than guessing.
const withOrgHeader = (user: TestUser, orgSlug: string): TestUser => {
  user.client.defaults.headers.common['x-organization-slug'] = orgSlug
  return user
}

export const createArmContext = async (
  options: CreateArmContextOptions,
): Promise<ArmContext> => {
  const provision = options.provisionUser ?? createTestUser
  const runAgent = options.runAgent ?? runAgentThroughRoutes
  const { baseUrl, profile, mode } = options

  const created = await provision({
    product: mode,
    // The API root, not the arm's root: an arm may be a webapp that proxies
    // gp-api at /api or a gp-api origin that serves /v1 itself.
    apiRoot: await resolveApiRoot(baseUrl),
    ...(profile.firstName ? { firstName: profile.firstName } : {}),
    ...(profile.lastName ? { lastName: profile.lastName } : {}),
    ...(profile.race ? { race: profile.race } : {}),
    ...(profile.election ? { election: profile.election } : {}),
    ...(profile.positionId ? { positionId: profile.positionId } : {}),
    ...(profile.positionName ? { positionName: profile.positionName } : {}),
    ...(profile.termStartDate ? { termStartDate: profile.termStartDate } : {}),
    ...(profile.termEndDate ? { termEndDate: profile.termEndDate } : {}),
  })
  const user = withOrgHeader(created, created.orgSlug)

  const transport = {
    post: async (path: string, body: unknown) => {
      const { data } = await user.client.post(path, body)
      return data
    },
    get: async (path: string) => {
      const { data } = await user.client.get(path)
      return data
    },
  }

  const ctx: EvalContext = {
    api: toEvalApi(user),
    baseUrl,
    org: { slug: user.orgSlug },
    runAgent: (name, input) =>
      runAgent(name, input, {
        transport,
        ...(options.pollIntervalMs !== undefined
          ? { pollIntervalMs: options.pollIntervalMs }
          : {}),
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : {}),
      }),
  }

  return {
    ctx,
    user: {
      user: user.user,
      orgSlug: user.orgSlug,
      clerkUserId: user.clerkUserId,
    },
  }
}

export type ArmReachability = {
  baseUrl: string
  ok: boolean
  detail: string
}

// A run id no arm can hold, so the answer says whether the ROUTE exists rather
// than whether the run does. Without a session the route's guard answers 401
// before the handler runs; a route that is not there answers Nest's own
// `Cannot GET ...` 404. Those two are the difference between an arm that can be
// judged and one whose deploy is missing the routes, and reading it before the
// first run is what stops a whole sweep from grading nothing but 404s — the
// mistake PR #3926 made expensive.
//
// Both roots are asked, the way `resolveApiRoot` does: a webapp serves gp-api at
// `/api` and answers a bare `/v1/...` with its login page, so an HTML 200 is not
// an answer about the route at all and the probe keeps looking.
const routeAnswerAt = async (
  url: string,
): Promise<{ answers: boolean; detail: string }> => {
  let status: number | 'no response' = 'no response'
  let message = ''
  let json = false
  try {
    const response = await axios.get(url, {
      timeout: probeTimeoutMs,
      validateStatus: () => true,
      // A webapp preview answers the Vercel login page otherwise, which is not
      // the arm's own answer to anything.
      headers: vercelBypassHeaders(),
    })
    status = response.status
    const body = response.data
    json = typeof body === 'object' && body !== null
    const { message: bodyMessage } = body as { message?: unknown }
    if (typeof bodyMessage === 'string') message = bodyMessage
  } catch (error) {
    return {
      answers: false,
      detail: `${url} got no response (${error instanceof Error ? error.message : String(error)})`,
    }
  }

  if (!json) return { answers: false, detail: `${url} answered ${status}` }
  if (status === 401) return { answers: true, detail: `${url} answered 401` }
  if (status === 404 && !message.startsWith('Cannot ')) {
    return { answers: true, detail: `${url} answered 404` }
  }
  if (status === 404) {
    return {
      answers: false,
      detail: `${url} answered 404 for a route that does not exist (${message})`,
    }
  }
  return {
    answers: false,
    detail: `${url} answered ${status}${message ? ` (${message})` : ''}`,
  }
}

const runRoutesAnswer = async (
  baseUrl: string,
): Promise<{ ok: boolean; detail: string }> => {
  const runId = randomUUID()
  const details: string[] = []
  for (const root of [baseUrl, `${baseUrl}/api`]) {
    const answer = await routeAnswerAt(`${root}/v1/agents/runs/${runId}`)
    if (answer.answers) return { ok: true, detail: answer.detail }
    details.push(answer.detail)
  }
  return {
    ok: false,
    detail:
      `${details.join('; ')} — so this arm's gp-api may not have the run ` +
      `routes deployed`,
  }
}

// Fail before spending anything if an arm cannot be reached, or cannot answer
// the run route the whole comparison depends on. The first check is
// `/v1/version` on whichever root the URL resolves to: it 200s on a live gp-api
// and fails when an origin resolves but serves nothing — a preview that has not
// rolled out yet, or a URL that is not an arm at all. `resolveApiRoot` probes
// both shapes and throws rather than guessing, so its refusal IS the
// unreachability report, and it names what it read the way judge.yml's gate does.
export const probeArm = async (baseUrl: string): Promise<ArmReachability> => {
  try {
    await resolveApiRoot(baseUrl)
  } catch (error) {
    return {
      baseUrl,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
  const route = await runRoutesAnswer(baseUrl.replace(/\/$/, ''))
  return { baseUrl, ok: route.ok, detail: route.detail }
}

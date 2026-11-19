import axios from 'axios'
import { createTestUser, type TestUser } from '@goodparty_org/test-users'
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
    apiBaseUrl: baseUrl,
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

// Fail before spending anything if an arm cannot be reached, or cannot answer
// the run route the whole comparison depends on.
export const probeArm = async (baseUrl: string): Promise<ArmReachability> => {
  try {
    const response = await axios.get(`${baseUrl}/`, {
      timeout: 20_000,
      validateStatus: () => true,
    })
    if (response.status >= 500) {
      return {
        baseUrl,
        ok: false,
        detail: `GET / returned ${response.status}`,
      }
    }
    return { baseUrl, ok: true, detail: `GET / returned ${response.status}` }
  } catch (error) {
    return {
      baseUrl,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

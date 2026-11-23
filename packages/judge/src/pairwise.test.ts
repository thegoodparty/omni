import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest'
import axios from 'axios'
import { DEFAULT_DIMENSIONS } from './grade'
import { definePairwiseAgentEvalSuite, type PairwiseVitest } from './pairwise'
import type { Annotate } from './annotation'

const { generateObject, provision } = vi.hoisted(() => ({
  generateObject: vi.fn(),
  provision: vi.fn(),
}))
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject,
}))
vi.mock('@goodparty_org/test-users', () => ({
  createTestUser: provision,
  vercelBypassHeaders: () => ({}),
}))

const definition = {
  mode: 'serve' as const,
  profile: {},
  cases: [
    { id: 'first', input: {} },
    { id: 'second', input: {} },
  ],
  run: async (_input: object, ctx: import('./suite').EvalContext) => {
    const result = await ctx.runAgent('fixture', {})
    if (result.error) throw new Error(result.error)
    return String(result.artifact)
  },
}

const collect = (env: NodeJS.ProcessEnv) => {
  const tests: { id: string; run: (context: TestContext) => Promise<void> }[] =
    []
  const meta: {
    pairwiseVerdict?: { message: string }
    pairwiseNotJudged?: { message: string }
  } = {}
  const hooks: { before?: () => Promise<void>; after?: () => Promise<void> } =
    {}
  const describe = vi.fn((_name: string, body: () => void) => body())
  const skip = vi.fn(describe.getMockImplementation())
  const globals = {
    describe: Object.assign(describe, { skip }),
    it: {
      concurrent: (id: string, run: (context: TestContext) => Promise<void>) =>
        tests.push({ id, run }),
    },
    beforeAll: (hook: () => Promise<void>) => {
      hooks.before = hook
    },
    afterAll: (hook: (_context: object, task: { meta: object }) => void) => {
      hooks.after = async () => hook({}, { meta })
    },
  } as unknown as PairwiseVitest
  for (const [key, value] of Object.entries(globals)) vi.stubGlobal(key, value)
  for (const key of [
    'JUDGE_BASE_URL',
    'JUDGE_CANDIDATE_URL',
    'JUDGE_REQUIRE_PAIRWISE',
    'JUDGE_MODEL',
    'CLERK_SECRET_KEY',
  ])
    vi.stubEnv(key, env[key])
  definePairwiseAgentEvalSuite('example', definition)
  return { tests, hooks, skip, describe, meta }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const env = {
  JUDGE_BASE_URL: 'https://base.invalid',
  JUDGE_CANDIDATE_URL: 'https://candidate.invalid',
  JUDGE_MODEL: 'anthropic/example',
  CLERK_SECRET_KEY: 'fake',
}

describe('definePairwiseAgentEvalSuite', () => {
  it('registers a skipped suite with a diagnostic when an arm is missing', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { skip, tests, hooks } = collect({
      JUDGE_BASE_URL: env.JUDGE_BASE_URL,
    })
    expect(skip).toHaveBeenCalledOnce()
    expect(tests.map(({ id }) => id)).toEqual(['first', 'second'])
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('JUDGE_CANDIDATE_URL'),
    )
    expect(hooks.before).toBeUndefined()
  })

  it('fails before spending when an arm is required', async () => {
    const { hooks } = collect({
      ...env,
      JUDGE_BASE_URL: undefined,
      JUDGE_REQUIRE_PAIRWISE: 'true',
    })
    await expect(hooks.before?.()).rejects.toThrow('JUDGE_BASE_URL')
    expect(provision).not.toHaveBeenCalled()
  })

  it.each([
    ['base', 'WORSE'],
    ['candidate', 'BETTER'],
    ['tie', 'NO DIFFERENCE FOUND'],
    ['failure', "CAN'T JUDGE"],
  ] as const)(
    'grades %s through both orders and gates the suite as %s',
    async (winner, label) => {
      let users = 0
      const reasoning = `first\n${'a'.repeat(31)}`
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const request = new Request(input)
        const { hostname, pathname } = new URL(request.url)
        if (pathname === '/v1/version') return Response.json({})
        if (request.method === 'POST')
          return Response.json({ runId: `run-${users}` })
        if (!request.headers.has('x-organization-slug'))
          return Response.json({ message: 'Unauthorized' }, { status: 401 })
        return Response.json({
          status: winner === 'failure' ? 'failed' : 'completed',
          engine: 'fake-engine',
          artifact: hostname,
        })
      })
      const adapter = axios.defaults.adapter
      const axiosEnv = axios.defaults.env
      axios.defaults.adapter = 'fetch'
      axios.defaults.env = { ...axiosEnv, fetch }
      try {
        provision.mockImplementation(
          async ({ apiRoot }: { apiRoot: string }) => {
            const id = ++users
            return {
              client: axios.create({ baseURL: apiRoot }),
              clerkUserId: `user-${id}`,
              orgSlug: `org-${id}`,
            }
          },
        )
        generateObject.mockImplementation(
          async ({ prompt }: { prompt: string }) => ({
            object: {
              winner:
                winner === 'tie'
                  ? 'tie'
                  : prompt.includes(`OUTPUT A\n${winner}.invalid`)
                    ? 'A'
                    : 'B',
              reasoning,
              dimensions: Object.keys(DEFAULT_DIMENSIONS).map((name) => ({
                name,
                A: 4,
                B: 4,
              })),
            },
            usage: { inputTokens: 1, outputTokens: 1 },
          }),
        )
        const { hooks, tests, meta } = collect(env)
        expect(tests.map(({ id }) => id)).toEqual(['first', 'second'])
        await hooks.before?.()
        const annotate = vi.fn<Annotate>()
        const context = { annotate } as unknown as TestContext
        const results = await Promise.allSettled(
          tests.map(({ run }) => run(context)),
        )
        expect(results.map(({ status }) => status)).toEqual(
          Array(2).fill(winner === 'failure' ? 'rejected' : 'fulfilled'),
        )
        expect(provision).toHaveBeenCalledTimes(12)
        expect(generateObject).toHaveBeenCalledTimes(
          winner === 'failure' ? 0 : 12,
        )
        expect(
          annotate.mock.calls.filter(([, type]) => type === 'pairwise-run'),
        ).toHaveLength(12)
        expect(annotate).toHaveBeenCalledWith(
          expect.stringContaining('fake-engine'),
          'pairwise-run',
        )
        // The producer redacts per string and posts the result unredacted, so a
        // 31-character word after a newline survives the pattern that would
        // otherwise eat the `n` of the `\n` and leave invalid JSON.
        const readings = annotate.mock.calls.filter(
          ([, type]) =>
            type === 'pairwise-order' || type === 'pairwise-decision',
        )
        if (winner !== 'failure') {
          expect(readings).toHaveLength(18)
          for (const [message] of readings)
            expect(() => JSON.parse(message)).not.toThrow()
          const orders = readings.filter(([, type]) => type.includes('order'))
          for (const [message] of orders)
            expect(JSON.parse(message).reasoning).toBe(reasoning)
        }
        if (label === 'WORSE' || label === "CAN'T JUDGE")
          await expect(hooks.after?.()).rejects.toThrow(label)
        else await expect(hooks.after?.()).resolves.toBeUndefined()
        const verdict = meta.pairwiseVerdict?.message
        expect(JSON.parse(String(verdict))).toMatchObject({ label })
        const notJudged = JSON.parse(String(meta.pairwiseNotJudged?.message))
        expect(notJudged).toHaveLength(winner === 'failure' ? 12 : 0)
        if (winner === 'failure')
          expect(notJudged[0]).toMatchObject({
            side: expect.stringMatching(/^(base|candidate)$/),
            runs: [{ runId: expect.stringMatching(/^run-/), status: 'failed' }],
            error: 'run failed',
          })
      } finally {
        axios.defaults.adapter = adapter
        axios.defaults.env = axiosEnv
      }
    },
  )

  it('keeps the not-judged list valid JSON when an error has a newline before a run ID', async () => {
    const runId = 'b5474767-7a55-4029-8b43-e720f85e53b8'
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const request = new Request(input)
      const { pathname } = new URL(request.url)
      if (pathname === '/v1/version') return Response.json({})
      if (request.method === 'POST') return Response.json({ runId })
      if (!request.headers.has('x-organization-slug'))
        return Response.json({ message: 'Unauthorized' }, { status: 401 })
      return Response.json({
        status: 'failed',
        error: `Agent run failed\n${'a'.repeat(31)}\n${runId}`,
      })
    })
    const adapter = axios.defaults.adapter
    const axiosEnv = axios.defaults.env
    axios.defaults.adapter = 'fetch'
    axios.defaults.env = { ...axiosEnv, fetch }
    try {
      provision.mockImplementation(
        async ({ apiRoot }: { apiRoot: string }) => ({
          client: axios.create({ baseURL: apiRoot }),
          clerkUserId: 'user',
          orgSlug: 'org',
        }),
      )
      const { hooks, tests, meta } = collect(env)
      await hooks.before?.()
      const context = { annotate: vi.fn<Annotate>() } as unknown as TestContext
      await Promise.allSettled(tests.map(({ run }) => run(context)))
      await hooks.after?.().catch(() => {})
      const notJudged = JSON.parse(String(meta.pairwiseNotJudged?.message))
      expect(notJudged[0].error).toContain(`\n${'a'.repeat(31)}\n${runId}`)
    } finally {
      axios.defaults.adapter = adapter
      axios.defaults.env = axiosEnv
    }
  })
})

import { describe, expect, it } from 'vitest'
import { ATTEMPTS_PER_SIDE, executeSuite, outputOrFailure } from './execute'
import type { GradedPair, Grader, PairRequest } from './grade'
import type { ArmContext } from './arm'
import { definePairwiseAgentEvalSuite, type EvalContext } from './suite'

const pairOf = (request: PairRequest): GradedPair => ({
  caseId: request.caseId,
  attempt: request.attempt,
  winner: 'tie',
  orders: [],
  handled: null,
  scores: {},
  usage: { inputTokens: 0, outputTokens: 0 },
})

const recorder = () => {
  const requests: PairRequest[] = []
  const grader: Grader = {
    gradePair: async (request) => {
      requests.push(request)
      return pairOf(request)
    },
    gradeOrder: async () => {
      throw new Error('the pool only calls gradePair')
    },
  }
  return { requests, grader }
}

// No network: an arm context is a fake user and a fake ctx.
const armFactory = (runs: string[]) => {
  const created: { arm: string; baseUrl: string }[] = []
  let index = 0
  return {
    created,
    factory: async (options: {
      arm: 'base' | 'candidate'
      baseUrl: string
      profile: unknown
      mode: 'win' | 'serve'
    }): Promise<ArmContext> => {
      created.push({ arm: options.arm, baseUrl: options.baseUrl })
      const output = runs[index % runs.length]!
      index += 1
      return {
        ctx: {
          api: {} as EvalContext['api'],
          baseUrl: options.baseUrl,
          org: { slug: `org-${options.arm}-${created.length}` },
          runAgent: async () => ({
            runId: `run-${created.length}`,
            status: 'completed' as const,
            artifact: null,
            error: null,
          }),
        },
        user: {
          user: {
            id: created.length,
            firstName: 'x',
            lastName: 'y',
            email: 'e@test.goodparty.org',
            name: 'x y',
            zip: '82001',
            phone: '2015550100',
            password: 'p',
          },
          orgSlug: `org-${options.arm}-${created.length}`,
          clerkUserId: `clerk-${created.length}`,
        },
      }
    },
  }
}

const suiteOf = (caseCount: number) =>
  definePairwiseAgentEvalSuite<{ topic: string }>('a_suite', {
    mode: 'win',
    profile: {
      race: { zip: '82001', office: 'Cheyenne City Council - Ward 1' },
    },
    run: async (input) => `output for ${input.topic}`,
    cases: Array.from({ length: caseCount }, (_, index) => ({
      id: `case-${index}`,
      input: { topic: `topic-${index}` },
    })),
  })

describe('executeSuite', () => {
  it('runs every case ATTEMPTS_PER_SIDE times on each arm', async () => {
    const { factory, created } = armFactory(['out'])
    const { requests, grader } = recorder()
    const result = await executeSuite({
      suite: suiteOf(2),
      baseUrl: 'https://base',
      candidateUrl: 'https://candidate',
      grader,
      concurrency: 4,
      createArmContextFn: factory as never,
    })
    expect(created).toHaveLength(2 * ATTEMPTS_PER_SIDE * 2)
    expect(result.cases).toHaveLength(2)
    for (const theCase of result.cases) {
      expect(theCase.runs).toHaveLength(ATTEMPTS_PER_SIDE * 2)
      expect(theCase.runs.filter((run) => run.arm === 'base')).toHaveLength(
        ATTEMPTS_PER_SIDE,
      )
      expect(theCase.pairs).toHaveLength(ATTEMPTS_PER_SIDE)
    }
    expect(requests).toHaveLength(2 * ATTEMPTS_PER_SIDE)
  })

  it('provisions each attempt on the arm URL it belongs to', async () => {
    const { factory, created } = armFactory(['out'])
    const { grader } = recorder()
    await executeSuite({
      suite: suiteOf(1),
      baseUrl: 'https://base',
      candidateUrl: 'https://candidate',
      grader,
      concurrency: 6,
      createArmContextFn: factory as never,
    })
    const base = created.filter((entry) => entry.arm === 'base')
    const candidate = created.filter((entry) => entry.arm === 'candidate')
    expect(base.every((entry) => entry.baseUrl === 'https://base')).toBe(true)
    expect(
      candidate.every((entry) => entry.baseUrl === 'https://candidate'),
    ).toBe(true)
    expect(base).toHaveLength(ATTEMPTS_PER_SIDE)
    expect(candidate).toHaveLength(ATTEMPTS_PER_SIDE)
  })

  it('grades each pair exactly once, with one output from each arm', async () => {
    // The suite's output names its own arm, so which string landed in which side
    // of the pair request is visible.
    const suite = definePairwiseAgentEvalSuite<{ topic: string }>('arm_named', {
      mode: 'win',
      profile: {},
      run: async (_input, ctx) => `output from ${ctx.org.slug}`,
      cases: [{ id: 'case-0', input: { topic: 't' } }],
    })
    const { factory } = armFactory(['unused'])
    const { requests, grader } = recorder()
    await executeSuite({
      suite,
      baseUrl: 'https://base',
      candidateUrl: 'https://candidate',
      grader,
      concurrency: 6,
      createArmContextFn: factory as never,
    })
    expect(requests).toHaveLength(ATTEMPTS_PER_SIDE)
    const attempts = requests.map((request) => request.attempt).sort()
    expect(attempts).toEqual([1, 2, 3])
    for (const request of requests) {
      expect(request.baseOutput).toMatch(/output from org-base-/)
      expect(request.candidateOutput).toMatch(/output from org-candidate-/)
    }
  })

  it('starts grading before every run has landed', async () => {
    // The candidate arm's runs never resolve until the base's pair is graded, so
    // a run that did not overlap grading would deadlock here.
    const { factory } = armFactory(['base out', 'candidate out'])
    let pairGradedBeforeAllRuns = false
    const { grader } = recorder()
    const result = await executeSuite({
      suite: suiteOf(1),
      baseUrl: 'https://base',
      candidateUrl: 'https://candidate',
      grader: {
        ...grader,
        gradePair: async (request) => {
          pairGradedBeforeAllRuns = true
          return pairOf(request)
        },
      },
      concurrency: 6,
      createArmContextFn: factory as never,
    })
    expect(result.cases[0]!.pairs).toHaveLength(ATTEMPTS_PER_SIDE)
    expect(pairGradedBeforeAllRuns).toBe(true)
  })

  it('keeps the setup before the run and times both', async () => {
    const order: string[] = []
    const suite = definePairwiseAgentEvalSuite<{ topic: string }>(
      'setup_suite',
      {
        mode: 'win',
        profile: {},
        run: async () => {
          order.push('run')
          return 'out'
        },
        cases: [
          {
            id: 'case-0',
            input: { topic: 't' },
            setup: async () => {
              order.push('setup')
            },
          },
        ],
      },
    )
    let clock = 0
    const { factory } = armFactory(['out'])
    const { grader } = recorder()
    const result = await executeSuite({
      suite,
      baseUrl: 'https://base',
      candidateUrl: 'https://candidate',
      grader,
      // One lane, so the interleaving of the six runs cannot reorder them.
      concurrency: 1,
      createArmContextFn: factory as never,
      now: () => (clock += 5),
    })
    // Six runs: three attempts on each arm, each its own setup then run.
    expect(order).toHaveLength(ATTEMPTS_PER_SIDE * 2 * 2)
    for (let index = 0; index < order.length; index += 2) {
      expect(order.slice(index, index + 2)).toEqual(['setup', 'run'])
    }
    expect(result.cases[0]!.runs.every((run) => run.setupMs === 5)).toBe(true)
  })

  it('turns a thrown run into a failure output, not a hole in the data', async () => {
    const suite = definePairwiseAgentEvalSuite<{ topic: string }>('throwy', {
      mode: 'win',
      profile: {},
      run: async () => {
        throw new Error('the agent route 500d')
      },
      cases: [{ id: 'case-0', input: { topic: 't' } }],
    })
    const { factory } = armFactory(['out'])
    const { requests, grader } = recorder()
    const result = await executeSuite({
      suite,
      baseUrl: 'https://base',
      candidateUrl: 'https://candidate',
      grader,
      concurrency: 2,
      createArmContextFn: factory as never,
    })
    const failed = result.cases[0]!.runs.find((run) => run.error !== null)
    expect(failed?.error).toBe('the agent route 500d')
    expect(failed?.output).toBeNull()
    // The pair is still graded, so the failure counts against the arm that made it.
    expect(requests).toHaveLength(ATTEMPTS_PER_SIDE)
    expect(requests[0]!.baseOutput).toContain('the run failed')
  })

  it('refuses a run that returns something other than a string', async () => {
    const suite = definePairwiseAgentEvalSuite<{ topic: string }>(
      'wrong_type',
      {
        mode: 'win',
        profile: {},
        run: async () => ({ artifact: 'not a string' }) as never,
        cases: [{ id: 'case-0', input: { topic: 't' } }],
      },
    )
    const { factory } = armFactory(['out'])
    const { grader } = recorder()
    const result = await executeSuite({
      suite,
      baseUrl: 'https://base',
      candidateUrl: 'https://candidate',
      grader,
      concurrency: 2,
      createArmContextFn: factory as never,
    })
    expect(result.cases[0]!.runs[0]!.error).toMatch(/not a string/)
  })

  it('passes the suite profile and mode to every arm context', async () => {
    const seen: { profile: unknown; mode: string }[] = []
    const { factory } = armFactory(['out'])
    const { grader } = recorder()
    const suite = suiteOf(1)
    await executeSuite({
      suite,
      baseUrl: 'https://base',
      candidateUrl: 'https://candidate',
      grader,
      concurrency: 2,
      createArmContextFn: (async (options: never) => {
        seen.push({
          profile: (options as { profile: unknown }).profile,
          mode: (options as { mode: string }).mode,
        })
        return factory(options)
      }) as never,
    })
    expect(seen).toHaveLength(ATTEMPTS_PER_SIDE * 2)
    expect(seen.every((entry) => entry.mode === 'win')).toBe(true)
    expect(seen.every((entry) => entry.profile === suite.profile)).toBe(true)
  })

  it('sums the grading token usage', async () => {
    const { factory } = armFactory(['out'])
    const { grader } = recorder()
    const result = await executeSuite({
      suite: suiteOf(1),
      baseUrl: 'https://base',
      candidateUrl: 'https://candidate',
      grader: {
        ...grader,
        gradePair: async (request) => ({
          ...pairOf(request),
          usage: { inputTokens: 10, outputTokens: 2 },
        }),
      },
      concurrency: 2,
      createArmContextFn: factory as never,
    })
    expect(result.usage).toEqual({
      inputTokens: 10 * ATTEMPTS_PER_SIDE,
      outputTokens: 2 * ATTEMPTS_PER_SIDE,
    })
  })
})

describe('outputOrFailure', () => {
  it('returns the output when there is one', () => {
    expect(outputOrFailure({ output: 'text', error: null })).toBe('text')
  })

  it('marks a failed run as such, so the judge reads it as evidence', () => {
    expect(outputOrFailure({ output: null, error: 'boom' })).toBe(
      '[the run failed: boom]',
    )
  })
})

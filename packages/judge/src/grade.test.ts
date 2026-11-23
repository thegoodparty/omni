import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import {
  buildGradingPrompt,
  createGrader,
  gradingSchema,
  DEFAULT_DIMENSIONS,
  gradePair,
  mean,
  orientOrder,
  readSlotVerdict,
  type Dimension,
  type OrderRequest,
  type SlotReading,
  type SlotVerdict,
} from './grade'

const dimensions: Dimension[] = Object.entries(DEFAULT_DIMENSIONS).map(
  ([name, question]) => ({ name, question }),
)

// A model's raw shape: the schema's `dimensions` array, still in A/B.
const rawVerdictOf = (
  winner: SlotVerdict['winner'],
  values: { a: number; b: number } = { a: 3, b: 3 },
): SlotVerdict => ({
  winner,
  reasoning: `${winner} because of the thing`,
  dimensions: dimensions.map((dimension) => ({
    name: dimension.name,
    A: values.a,
    B: values.b,
  })),
})

// The same reading with scores keyed by question, which is what gradePair and
// orientOrder take.
const verdictOf = (
  winner: SlotReading['winner'],
  values: { a: number; b: number } = { a: 3, b: 3 },
): SlotReading => ({
  winner,
  reasoning: `${winner} because of the thing`,
  handledWhen: null,
  scores: Object.fromEntries(
    dimensions.map((dimension) => [
      dimension.name,
      { A: values.a, B: values.b },
    ]),
  ),
})

const usage = { inputTokens: 10, outputTokens: 4 }

describe('buildGradingPrompt', () => {
  const request: OrderRequest = {
    caseId: 'case-1',
    task: 'Summarize the race.',
    grading: {
      condition: 'the race is uncontested',
      handledWhen: 'the output says the race is uncontested',
      dimensions: { tone: 'Is the tone appropriate?' },
    },
    dimensions,
    a: 'base output',
    b: 'candidate output',
  }

  it('names both outputs and never which arm produced them', () => {
    const prompt = buildGradingPrompt(request)
    expect(prompt).toContain('OUTPUT A\nbase output')
    expect(prompt).toContain('OUTPUT B\ncandidate output')
    expect(prompt).not.toContain('candidate arm')
    expect(prompt).not.toContain('base arm')
  })

  it('states the pass rule when the case has one', () => {
    const prompt = buildGradingPrompt(request)
    expect(prompt).toContain('PASS RULE')
    expect(prompt).toContain('the output says the race is uncontested')
  })

  it('omits the pass rule when the case has none', () => {
    const prompt = buildGradingPrompt({ ...request, grading: {} })
    expect(prompt).not.toContain('PASS RULE')
  })

  it('asks every dimension question', () => {
    const prompt = buildGradingPrompt(request)
    for (const dimension of dimensions) {
      expect(prompt).toContain(dimension.question)
    }
  })
})

describe('readSlotVerdict', () => {
  it('reads a well-formed verdict', () => {
    const verdict = readSlotVerdict(
      {
        winner: 'A',
        reasoning: 'A said more.',
        handledWhen: { A: 'yes', B: 'partly' },
        dimensions: dimensions.map((dimension) => ({
          name: dimension.name,
          A: 5,
          B: 2,
        })),
      },
      dimensions,
    )
    expect(verdict.winner).toBe('A')
    expect(verdict.handledWhen).toEqual({ A: 'yes', B: 'partly' })
    expect(verdict.scores.task_success).toEqual({ A: 5, B: 2 })
  })

  it('reads a verdict with no pass rule as having no handledWhen', () => {
    const verdict = readSlotVerdict(rawVerdictOf('tie'), dimensions)
    expect(verdict.handledWhen).toBeNull()
  })

  it('rejects an unusable winner and an empty reasoning, at the schema', () => {
    const schema = gradingSchema(dimensions, false)
    const wellFormed = {
      reasoning: 'x',
      dimensions: dimensions.map((dimension) => ({
        name: dimension.name,
        A: 3,
        B: 3,
      })),
    }
    expect(schema.safeParse({ ...wellFormed, winner: 'C' }).success).toBe(false)
    expect(
      schema.safeParse({ ...wellFormed, winner: 'tie', reasoning: '' }).success,
    ).toBe(false)
    expect(schema.safeParse({ ...wellFormed, winner: 'tie' }).success).toBe(
      true,
    )
  })

  it('asks for handledWhen only when the case has a pass rule', () => {
    const entries = (hasRule: boolean) =>
      Object.keys(
        (
          gradingSchema(dimensions, hasRule) as unknown as {
            shape: Record<string, unknown>
          }
        ).shape,
      )
    expect(entries(true)).toContain('handledWhen')
    expect(entries(false)).not.toContain('handledWhen')
  })

  it('rejects a missing dimension, rather than scoring it 0', () => {
    expect(() =>
      readSlotVerdict(
        {
          winner: 'tie',
          reasoning: 'x',
          dimensions: [{ name: dimensions[0]!.name, A: 3, B: 3 }],
        },
        dimensions,
      ),
    ).toThrow(/no scores for/)
  })

  it('rejects an unknown dimension', () => {
    expect(() =>
      readSlotVerdict(
        {
          winner: 'tie',
          reasoning: 'x',
          dimensions: [
            ...dimensions.map((dimension) => ({
              name: dimension.name,
              A: 3,
              B: 3,
            })),
            { name: 'vibes', A: 3, B: 3 },
          ],
        },
        dimensions,
      ),
    ).toThrow(/unknown dimension/)
  })

  it('rejects a repeated dimension', () => {
    const name = dimensions[0]!.name
    expect(() =>
      readSlotVerdict(
        {
          winner: 'tie',
          reasoning: 'x',
          dimensions: [
            { name, A: 3, B: 3 },
            { name, A: 4, B: 4 },
            ...dimensions.slice(1).map((dimension) => ({
              name: dimension.name,
              A: 3,
              B: 3,
            })),
          ],
        },
        dimensions,
      ),
    ).toThrow(/twice/)
  })
})

describe('orientOrder', () => {
  const verdict: SlotReading = {
    winner: 'A',
    reasoning: 'A was better',
    handledWhen: { A: 'yes', B: 'no' },
    scores: Object.fromEntries(
      dimensions.map((dimension) => [dimension.name, { A: 5, B: 2 }]),
    ),
  }

  it('maps A and B onto the arms when the base was shown as A', () => {
    const oriented = orientOrder(verdict, usage, false)
    expect(oriented.aArm).toBe('base')
    expect(oriented.winner).toBe('base')
    expect(oriented.handled).toEqual({ base: 'yes', candidate: 'no' })
    expect(oriented.scores.task_success).toEqual({ base: 5, candidate: 2 })
  })

  it('swaps them when the candidate was shown as A', () => {
    const oriented = orientOrder(verdict, usage, true)
    expect(oriented.aArm).toBe('candidate')
    expect(oriented.winner).toBe('candidate')
    expect(oriented.handled).toEqual({ base: 'no', candidate: 'yes' })
    expect(oriented.scores.task_success).toEqual({ base: 2, candidate: 5 })
  })

  it('keeps a tie a tie in either order', () => {
    expect(
      orientOrder({ ...verdict, winner: 'tie' }, usage, false).winner,
    ).toBe('tie')
    expect(orientOrder({ ...verdict, winner: 'tie' }, usage, true).winner).toBe(
      'tie',
    )
  })
})

describe('gradePair', () => {
  const baseRequest = {
    caseId: 'case-1',
    attempt: 1,
    task: 'task text',
    grading: {},
    dimensions,
    baseOutput: 'the base output',
    candidateOutput: 'the candidate output',
  }

  it('judges both orders and reads agreement as a direction', async () => {
    // The model prefers whichever output it is shown as A, whatever it is. Both
    // orders therefore point the same way in slot terms, and orienting them puts
    // them on opposite arms: a disagreement, hence a tie.
    const calls: string[] = []
    const gradeOrder = async (request: OrderRequest) => {
      calls.push(request.a)
      return { verdict: verdictOf('A'), usage }
    }
    const pair = await gradePair(baseRequest, gradeOrder)
    expect(calls).toEqual(['the base output', 'the candidate output'])
    expect(pair.orders).toHaveLength(2)
    expect(pair.winner).toBe('tie')
  })

  it('reads two orders that name the same arm as that arm', async () => {
    // Slot A is the base first, then the candidate. Naming A first and B second
    // is the base winning, then the candidate winning: a genuine disagreement.
    // To make both point at the candidate, the model has to name B in the first
    // order.
    let call = 0
    const gradeOrder = async () => {
      call += 1
      return { verdict: verdictOf(call === 1 ? 'B' : 'A'), usage }
    }
    const pair = await gradePair(baseRequest, gradeOrder)
    expect(pair.winner).toBe('candidate')
  })

  it('is a tie when either order says tie', async () => {
    let call = 0
    const gradeOrder = async () => {
      call += 1
      return { verdict: verdictOf(call === 1 ? 'tie' : 'B'), usage }
    }
    expect((await gradePair(baseRequest, gradeOrder)).winner).toBe('tie')
  })

  it('counts handled only when both orders said yes', async () => {
    // Slot A is the base in the first order and the candidate in the second.
    // `handled('yes', 'no')` therefore says base yes, candidate no; the reverse
    // call says base yes, candidate yes. The candidate was not handled in every
    // order, so it is not handled.
    const handled = (
      A: 'yes' | 'partly' | 'no',
      B: 'yes' | 'partly' | 'no',
    ) => ({
      verdict: { ...verdictOf('tie'), handledWhen: { A, B } },
      usage,
    })
    let call = 0
    const gradeOrder = async () => {
      call += 1
      return call === 1 ? handled('yes', 'no') : handled('yes', 'yes')
    }
    const pair = await gradePair(baseRequest, gradeOrder)
    expect(pair.handled).toEqual({ base: true, candidate: false })
  })

  it('counts handled for both arms when every order said yes', async () => {
    const gradeOrder = async () => ({
      verdict: {
        ...verdictOf('tie'),
        handledWhen: { A: 'yes' as const, B: 'yes' as const },
      },
      usage,
    })
    const pair = await gradePair(baseRequest, gradeOrder)
    expect(pair.handled).toEqual({ base: true, candidate: true })
  })

  it('is not handled when one order says partly', async () => {
    let call = 0
    const gradeOrder = async () => {
      call += 1
      return {
        verdict: {
          ...verdictOf('tie'),
          handledWhen:
            call === 1
              ? { A: 'partly' as const, B: 'yes' as const }
              : { A: 'yes' as const, B: 'yes' as const },
        },
        usage,
      }
    }
    expect((await gradePair(baseRequest, gradeOrder)).handled).toEqual({
      base: false,
      candidate: true,
    })
  })

  it('averages each dimension over the orders', async () => {
    // Base is A in the first order and B in the second, so both orders have to
    // score base 4 for the average to be 4.
    let call = 0
    const gradeOrder = async () => {
      call += 1
      return {
        verdict: verdictOf('tie', call === 1 ? { a: 4, b: 2 } : { a: 2, b: 4 }),
        usage,
      }
    }
    const pair = await gradePair(baseRequest, gradeOrder)
    expect(pair.scores.task_success).toEqual({ base: 4, candidate: 2 })
  })

  it('sums the token usage of both orders', async () => {
    const gradeOrder = async () => ({ verdict: verdictOf('tie'), usage })
    const pair = await gradePair(baseRequest, gradeOrder)
    expect(pair.usage).toEqual({ inputTokens: 20, outputTokens: 8 })
  })
})

describe('createGrader', () => {
  const model = new MockLanguageModelV3()

  it('drives the AI SDK generateObject with the schema and prompt', async () => {
    const prompts: string[] = []
    const grader = createGrader({
      model,
      generateObjectFn: async ({ prompt }) => {
        prompts.push(prompt)
        return {
          object: {
            winner: 'A',
            reasoning: 'A.',
            dimensions: dimensions.map((dimension) => ({
              name: dimension.name,
              A: 5,
              B: 1,
            })),
          },
          usage,
        }
      },
    })
    const pair = await grader.gradePair({
      caseId: 'case-1',
      attempt: 1,
      task: 'task',
      grading: {},
      dimensions,
      baseOutput: 'base',
      candidateOutput: 'candidate',
    })
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('OUTPUT A\nbase')
    expect(prompts[1]).toContain('OUTPUT A\ncandidate')
    // A model that always prefers slot A prefers each arm once, so the pair is
    // a tie. That is the property the order swap exists to catch.
    expect(pair.winner).toBe('tie')
  })

  it('reads a model that prefers the same arm in both orders as that arm', async () => {
    let call = 0
    const grader = createGrader({
      model,
      generateObjectFn: async () => {
        call += 1
        return {
          object: {
            // Base is A first, so slot B is the candidate: naming B first then A
            // names the candidate twice.
            winner: call === 1 ? 'B' : 'A',
            reasoning: 'the candidate was better',
            dimensions: dimensions.map((dimension) => ({
              name: dimension.name,
              A: 5,
              B: 1,
            })),
          },
          usage,
        }
      },
    })
    const pair = await grader.gradePair({
      caseId: 'case-1',
      attempt: 1,
      task: 'task',
      grading: {},
      dimensions,
      baseOutput: 'base',
      candidateOutput: 'candidate',
    })
    expect(pair.winner).toBe('candidate')
  })

  it('goes through the real generateObject against the mock model', async () => {
    const mock = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              winner: 'B',
              reasoning: 'B is more specific.',
              dimensions: dimensions.map((dimension) => ({
                name: dimension.name,
                A: 2,
                B: 5,
              })),
            }),
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 3, text: 3, reasoning: 0 },
        },
        warnings: [],
      }),
    })
    const grader = createGrader({ model: mock })
    const order = await grader.gradeOrder({
      caseId: 'case-1',
      task: 'task',
      grading: {},
      dimensions,
      a: 'base',
      b: 'candidate',
    })
    expect(order.verdict.winner).toBe('B')
    expect(order.usage).toEqual({ inputTokens: 7, outputTokens: 3 })
  })
})

describe('gradingSchema', () => {
  // Claude's native JSON output scores 3.5; an integer-only schema rejected the
  // whole verdict, and so every pair, on PR #3898.
  it('accepts a half-point score and rejects one outside 1 to 5', () => {
    const schema = gradingSchema(dimensions, false)
    const verdict = (score: number) => ({
      winner: 'A',
      reasoning: 'A.',
      dimensions: dimensions.map(({ name }) => ({ name, A: score, B: 3 })),
    })
    expect(schema.safeParse(verdict(3.5)).success).toBe(true)
    expect(schema.safeParse(verdict(0)).success).toBe(false)
    expect(schema.safeParse(verdict(5.5)).success).toBe(false)
  })
})

describe('mean', () => {
  it('is 0 for no values and the average otherwise', () => {
    expect(mean([])).toBe(0)
    expect(mean([2, 4])).toBe(3)
  })
})

import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import {
  buildGradingPrompt,
  createGrader,
  gradingSchema,
  DEFAULT_DIMENSIONS,
  gradePair,
  handledDirection,
  orientOrder,
  readSlotVerdict,
  type Dimension,
  type OrderRequest,
  type OrientedOrder,
  type SlotReading,
  type SlotVerdict,
} from './grade'

const dimensions: Dimension[] = Object.entries(DEFAULT_DIMENSIONS).map(
  ([name, question]) => ({ name, question }),
)

// A model's raw shape: the schema's `changes` array, still in A/B.
const rawVerdictOf = (
  better: 'A' | 'B' | 'none',
  criterion: string = dimensions[0]!.name,
): SlotVerdict => ({
  reasoning: `${better} because of the thing`,
  changes: dimensions.map((dimension) => ({
    criterion: dimension.name,
    better: dimension.name === criterion ? better : 'none',
    evidence: `${dimension.name}: A said one thing, B said another`,
  })),
})

// The same reading with the pass rule absent, which is what gradePair and
// orientOrder take.
const verdictOf = (
  better: 'A' | 'B' | 'none',
  criterion: string = dimensions[0]!.name,
): SlotReading => ({
  reasoning: `${better} because of the thing`,
  changes: dimensions.map((dimension) => ({
    criterion: dimension.name,
    better: dimension.name === criterion ? better : 'none',
    evidence: `${dimension.name}: A said one thing, B said another`,
  })),
  handledWhen: null,
})

const usage = { inputTokens: 10, outputTokens: 4 }

const orderWith = (
  aArm: OrientedOrder['aArm'],
  changes: OrientedOrder['changes'],
  handled: OrientedOrder['handled'] = null,
): OrientedOrder => ({
  aArm,
  changes,
  reasoning: 'because of the thing',
  handled,
  usage,
})

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

  it('asks every criterion question', () => {
    const prompt = buildGradingPrompt(request)
    for (const dimension of dimensions) {
      expect(prompt).toContain(dimension.question)
    }
  })

  it('asks for a per-criterion reading and rules out preference', () => {
    const prompt = buildGradingPrompt(request)
    expect(prompt).toContain(
      'For each criterion, answer which output behaves materially better',
    )
    expect(prompt).toContain(
      'Ignore preferences about wording, style, tone, length and formatting',
    )
    expect(prompt).toContain('Read each criterion on its own')
  })

  it('never asks for an overall winner or a score', () => {
    const prompt = buildGradingPrompt(request)
    expect(prompt).not.toContain('Pick the winner')
    expect(prompt).not.toContain('Score each question')
  })
})

describe('readSlotVerdict', () => {
  it('reads a well-formed verdict', () => {
    const verdict = readSlotVerdict(
      {
        reasoning: 'A said more.',
        changes: dimensions.map((dimension) => ({
          criterion: dimension.name,
          better: 'A',
          evidence: 'A named the district.',
        })),
        handledWhen: { A: 'yes', B: 'partly' },
      },
      dimensions,
    )
    expect(verdict.changes[0]).toMatchObject({
      criterion: dimensions[0]!.name,
      better: 'A',
      evidence: 'A named the district.',
    })
    expect(verdict.handledWhen).toEqual({ A: 'yes', B: 'partly' })
  })

  it('reads a verdict with no pass rule as having no handledWhen', () => {
    const verdict = readSlotVerdict(rawVerdictOf('none'), dimensions)
    expect(verdict.handledWhen).toBeNull()
  })

  it('rejects an unusable direction and an empty evidence string', () => {
    const schema = gradingSchema(dimensions, false)
    const wellFormed = {
      reasoning: 'x',
      changes: dimensions.map((dimension) => ({
        criterion: dimension.name,
        better: 'none',
        evidence: 'neither named the district',
      })),
    }
    expect(schema.safeParse({ ...wellFormed, better: 'C' }).success).toBe(true)
    expect(
      schema.safeParse({
        ...wellFormed,
        changes: [{ ...wellFormed.changes[0], better: 'C' }],
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        ...wellFormed,
        changes: [{ ...wellFormed.changes[0], evidence: '' }],
      }).success,
    ).toBe(false)
    expect(schema.safeParse({ ...wellFormed, reasoning: '' }).success).toBe(
      false,
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

  it('rejects a missing criterion, rather than reading it as no change', () => {
    expect(() =>
      readSlotVerdict(
        {
          reasoning: 'x',
          changes: [
            {
              criterion: dimensions[0]!.name,
              better: 'none',
              evidence: 'same',
            },
          ],
        },
        dimensions,
      ),
    ).toThrow(/no reading for/)
  })

  it('rejects an unknown criterion', () => {
    expect(() =>
      readSlotVerdict(
        {
          reasoning: 'x',
          changes: [
            ...dimensions.map((dimension) => ({
              criterion: dimension.name,
              better: 'none',
              evidence: 'same',
            })),
            { criterion: 'vibes', better: 'none', evidence: 'same' },
          ],
        },
        dimensions,
      ),
    ).toThrow(/unknown criteria/)
  })

  it('rejects a repeated criterion', () => {
    const criterion = dimensions[0]!.name
    expect(() =>
      readSlotVerdict(
        {
          reasoning: 'x',
          changes: [
            { criterion, better: 'none', evidence: 'same' },
            { criterion, better: 'A', evidence: 'A named it' },
            ...dimensions.slice(1).map((dimension) => ({
              criterion: dimension.name,
              better: 'none',
              evidence: 'same',
            })),
          ],
        },
        dimensions,
      ),
    ).toThrow(/twice/)
  })
})

describe('orientOrder', () => {
  const verdict: SlotReading & { handledWhen: { A: 'yes'; B: 'no' } } = {
    reasoning: 'A was better',
    changes: dimensions.map((dimension) => ({
      criterion: dimension.name,
      better: 'A',
      evidence: 'A named the district',
    })),
    handledWhen: { A: 'yes', B: 'no' },
  }

  it('maps A and B onto the arms when the base was shown as A', () => {
    const oriented = orientOrder(verdict, usage, false)
    expect(oriented.aArm).toBe('base')
    expect(oriented.changes[0]?.better).toBe('base')
    expect(oriented.handled).toEqual({ base: 'yes', candidate: 'no' })
  })

  it('swaps them when the candidate was shown as A', () => {
    const oriented = orientOrder(verdict, usage, true)
    expect(oriented.aArm).toBe('candidate')
    expect(oriented.changes[0]?.better).toBe('candidate')
    expect(oriented.handled).toEqual({ base: 'no', candidate: 'yes' })
  })

  it('keeps "none" as no change in either order', () => {
    const noChange: SlotReading = {
      ...verdict,
      changes: verdict.changes.map((change) => ({ ...change, better: 'none' })),
    }
    expect(orientOrder(noChange, usage, false).changes[0]?.better).toBe('none')
    expect(orientOrder(noChange, usage, true).changes[0]?.better).toBe('none')
  })
})

describe('handledDirection', () => {
  const handled = (
    base: 'yes' | 'partly' | 'no',
    candidate: 'yes' | 'partly' | 'no',
  ) => orderWith('base', [], { base, candidate })

  it('reads a better pass rule as a candidate improvement', () => {
    expect(handledDirection(handled('no', 'yes'))).toBe('candidate')
    expect(handledDirection(handled('partly', 'yes'))).toBe('candidate')
    expect(handledDirection(handled('no', 'partly'))).toBe('none')
  })

  it('reads a worse pass rule as a candidate regression', () => {
    expect(handledDirection(handled('yes', 'no'))).toBe('base')
    expect(handledDirection(handled('yes', 'partly'))).toBe('base')
  })

  it('is no change when both sides answered the same', () => {
    expect(handledDirection(handled('yes', 'yes'))).toBe('none')
    expect(handledDirection(handled('partly', 'partly'))).toBe('none')
    expect(handledDirection(orderWith('base', []))).toBe('none')
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

  it('judges both orders and confirms a criterion both read the same way', async () => {
    // Slot A is the base first, then the candidate. Both calls name A, which is
    // the base in one order and the candidate in the other: a disagreement, so
    // no criterion is confirmed.
    const calls: string[] = []
    const gradeOrder = async (request: OrderRequest) => {
      calls.push(request.a)
      return { verdict: verdictOf('A'), usage }
    }
    const pair = await gradePair(baseRequest, gradeOrder)
    expect(calls).toEqual(['the base output', 'the candidate output'])
    expect(pair.orders).toHaveLength(2)
    expect(pair.changes).toEqual([])
    expect(pair.disagreements).toEqual([dimensions[0]!.name])
  })

  it('confirms the change both orders read on the same arm', async () => {
    // Slot A is the base first, then the candidate. Naming B first and A second
    // names the candidate in both orders.
    let call = 0
    const gradeOrder = async () => {
      call += 1
      return { verdict: verdictOf(call === 1 ? 'B' : 'A'), usage }
    }
    const pair = await gradePair(baseRequest, gradeOrder)
    expect(pair.changes).toHaveLength(1)
    expect(pair.changes[0]?.criterion).toBe(dimensions[0]!.name)
    for (const change of pair.changes) {
      expect(change.direction).toBe('better')
      expect(change.evidence).toHaveLength(2)
    }
    expect(pair.disagreements).toEqual([])
  })

  it('leaves a criterion out when one order read a change and the other none', async () => {
    let call = 0
    const gradeOrder = async () => {
      call += 1
      return { verdict: verdictOf(call === 1 ? 'B' : 'none'), usage }
    }
    const pair = await gradePair(baseRequest, gradeOrder)
    expect(pair.changes).toEqual([])
    expect(pair.disagreements).toEqual([dimensions[0]!.name])
  })

  it('is no change at all when both orders read every criterion as none', async () => {
    const gradeOrder = async () => ({ verdict: verdictOf('none'), usage })
    const pair = await gradePair(baseRequest, gradeOrder)
    expect(pair.changes).toEqual([])
    expect(pair.disagreements).toEqual([])
  })

  it('keeps a regression and an improvement in the same pair', async () => {
    // Each order reads grounding worse and specificity better, in its own slot
    // terms. One direction must not erase the other.
    let call = 0
    const gradeOrder = async () => {
      call += 1
      const candidateIsA = call === 2
      const better = (candidateBetter: boolean) =>
        candidateIsA === candidateBetter ? 'A' : 'B'
      return {
        verdict: {
          reasoning: 'both moved',
          changes: [
            {
              criterion: 'grounding',
              better: better(false),
              evidence: 'one cited a source, the other did not',
            },
            {
              criterion: 'specificity',
              better: better(true),
              evidence: 'one named the street, the other did not',
            },
            ...dimensions
              .filter(
                (dimension) =>
                  dimension.name !== 'grounding' &&
                  dimension.name !== 'specificity',
              )
              .map((dimension) => ({
                criterion: dimension.name,
                better: 'none' as const,
                evidence: 'same',
              })),
          ],
          handledWhen: null,
        } satisfies SlotReading,
        usage,
      }
    }
    const pair = await gradePair(
      {
        ...baseRequest,
        dimensions: [
          {
            name: 'grounding',
            question: 'Does every claim trace to evidence?',
          },
          { name: 'specificity', question: 'Does it name the street?' },
        ],
      },
      gradeOrder,
    )
    expect(
      pair.changes.map(({ criterion, direction }) => [criterion, direction]),
    ).toEqual([
      ['grounding', 'worse'],
      ['specificity', 'better'],
    ])
  })

  it("keeps each order's own handledWhen readings", async () => {
    const handled = (
      A: 'yes' | 'partly' | 'no',
      B: 'yes' | 'partly' | 'no',
    ) => ({
      verdict: { ...verdictOf('none'), handledWhen: { A, B } },
      usage,
    })
    let call = 0
    const gradeOrder = async () => {
      call += 1
      return call === 1 ? handled('yes', 'no') : handled('yes', 'yes')
    }
    const pair = await gradePair(baseRequest, gradeOrder)
    expect(pair.orders.map(({ handled: reading }) => reading)).toEqual([
      { base: 'yes', candidate: 'no' },
      { base: 'yes', candidate: 'yes' },
    ])
  })

  it('does not confirm a pass-rule change when the orders disagree on it', async () => {
    const handled = async (
      A: 'yes' | 'partly' | 'no',
      B: 'yes' | 'partly' | 'no',
    ) => ({
      verdict: { ...verdictOf('none'), handledWhen: { A, B } },
      usage,
    })
    let call = 0
    const gradeOrder = async () => {
      call += 1
      return call === 1 ? handled('no', 'yes') : handled('yes', 'yes')
    }
    const pair = await gradePair(
      {
        ...baseRequest,
        grading: { handledWhen: 'the reply names a dated source' },
      },
      gradeOrder,
    )
    expect(pair.changes).toEqual([])
    expect(pair.disagreements).toEqual(['handledWhen'])
  })

  it('does not confirm a pass-rule change when one order says partly', async () => {
    let call = 0
    const gradeOrder = async () => {
      call += 1
      return {
        verdict: {
          ...verdictOf('none'),
          handledWhen:
            call === 1
              ? { A: 'partly' as const, B: 'yes' as const }
              : { A: 'yes' as const, B: 'yes' as const },
        },
        usage,
      }
    }
    const pair = await gradePair(
      {
        ...baseRequest,
        grading: { handledWhen: 'the reply names a dated source' },
      },
      gradeOrder,
    )
    expect(pair.changes).toEqual([])
    expect(pair.disagreements).toEqual(['handledWhen'])
  })

  it('reads a pass-rule drop both orders saw as a confirmed regression of its own', async () => {
    // Both orders agree the candidate no longer meets the rule, so the pair
    // confirms a `handledWhen` regression even though no dimension moved.
    let call = 0
    const gradeOrder = async () => {
      call += 1
      return {
        verdict: {
          ...verdictOf('none'),
          handledWhen:
            call === 1
              ? { A: 'yes' as const, B: 'no' as const }
              : { A: 'no' as const, B: 'yes' as const },
        },
        usage,
      }
    }
    const pair = await gradePair(
      {
        ...baseRequest,
        grading: { handledWhen: 'the reply names a dated source' },
      },
      gradeOrder,
    )
    expect(pair.changes).toContainEqual(
      expect.objectContaining({
        criterion: 'handledWhen',
        direction: 'worse',
      }),
    )
  })

  it('sums the token usage of both orders', async () => {
    const gradeOrder = async () => ({ verdict: verdictOf('none'), usage })
    const pair = await gradePair(baseRequest, gradeOrder)
    expect(pair.usage).toEqual({ inputTokens: 20, outputTokens: 8 })
  })
})

describe('createGrader', () => {
  const model = new MockLanguageModelV3()

  const noChangeObject = () => ({
    reasoning: 'No observable difference.',
    changes: dimensions.map((dimension) => ({
      criterion: dimension.name,
      better: 'none',
      evidence: 'both named the district',
    })),
  })

  it('drives the AI SDK generateObject with the schema and prompt', async () => {
    const prompts: string[] = []
    const grader = createGrader({
      model,
      generateObjectFn: async ({ prompt }) => {
        prompts.push(prompt)
        return {
          object: {
            reasoning: 'A named the district.',
            changes: dimensions.map((dimension) => ({
              criterion: dimension.name,
              better: 'A',
              evidence: 'A named the district',
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
    // A model that always prefers slot A prefers each arm once, so nothing is
    // confirmed. That is the property the order swap exists to catch.
    expect(pair.changes).toEqual([])
  })

  it('confirms nothing when both orders read every criterion as none', async () => {
    const grader = createGrader({
      model,
      generateObjectFn: async () => ({ object: noChangeObject(), usage }),
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
    expect(pair.changes).toEqual([])
    expect(pair.disagreements).toEqual([])
  })

  it('goes through the real generateObject against the mock model', async () => {
    const mock = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              reasoning: 'B named the street.',
              changes: dimensions.map((dimension) => ({
                criterion: dimension.name,
                better: 'B',
                evidence: 'B named the street',
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
    expect(order.verdict.changes[0]?.better).toBe('B')
    expect(order.usage).toEqual({ inputTokens: 7, outputTokens: 3 })
  })
})

describe('gradingSchema', () => {
  it('accepts one reading per criterion and rejects a reading outside A/B/none', () => {
    const schema = gradingSchema(dimensions, false)
    const verdict = (better: string) => ({
      reasoning: 'x',
      changes: dimensions.map(({ name }) => ({
        criterion: name,
        better,
        evidence: 'A said one thing, B another',
      })),
    })
    expect(schema.safeParse(verdict('none')).success).toBe(true)
    expect(schema.safeParse(verdict('tie')).success).toBe(false)
    expect(schema.safeParse(verdict('C')).success).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { JsonJudgeModel } from '../../general/ordinance-flow/evals/coldJudge'
import type { LlmMessage } from '../../../llm/types/llmMessages.types'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { BACKGROUND_PAIR, CHAT_PAIR } from './fixtures/records'
import {
  CaseVerdictSchema,
  judgeAll,
  judgeCase,
  OVERALL,
  planJudgments,
  selectSwapped,
  type GradedJudgment,
  type PlannedJudgment,
} from './judge'
import { blindCase, type NormalizedCase } from './normalize'
import type { JsonValue, RunRecord } from './record'

const [BASE, CANDIDATE] = CHAT_PAIR
const X_IS_BASE = () => 0

interface FakeCall {
  messages: LlmMessage[]
  models: string[] | undefined
  temperature: number | undefined
}

// Mirrors what LlmService does: the service parses the model's JSON against
// the schema, so a reply that violates it must fail here the same way.
const fake = (
  replies: readonly (JsonValue | Error)[],
): { llm: JsonJudgeModel; calls: FakeCall[] } => {
  const calls: FakeCall[] = []
  let index = 0
  return {
    calls,
    llm: {
      jsonCompletion: async (options) => {
        calls.push({
          messages: options.messages,
          models: options.models,
          temperature: options.temperature,
        })
        const reply = replies[Math.min(index, replies.length - 1)]
        index += 1
        if (reply instanceof Error) throw reply
        return {
          object: options.schema.parse(reply),
          tokens: 0,
          model: 'fake',
        }
      },
    },
  }
}

const dim = (
  verdict: string,
  magnitude: string | null = 'clear',
): JsonValue => ({
  reasoning: 'because',
  evidence: [{ loc: 'X.final', quote: 'q', note: 'n' }],
  verdict,
  magnitude,
})

const reply = (
  o: {
    overall?: string
    magnitude?: string | null
    dimensions?: Record<string, JsonValue>
    flags?: JsonValue[]
    floor?: JsonValue
  } = {},
): JsonValue => ({
  rubric_version: 'uj-rubric-0.2',
  shared_observations: 'both answered',
  dimensions: o.dimensions ?? {
    task_success: dim(o.overall ?? 'Y'),
    instruction_adherence: dim(o.overall ?? 'Y'),
    user_utility: dim(o.overall ?? 'Y'),
  },
  overall: dim(o.overall ?? 'Y', o.magnitude ?? 'clear'),
  flags: o.flags ?? [],
  absolute_floor: o.floor ?? {
    X_acceptable: 'yes',
    Y_acceptable: 'yes',
    note: '',
  },
})

const plan = (
  normalized: NormalizedCase,
  order: 'primary' | 'swapped' = 'primary',
): PlannedJudgment => ({
  key: { caseId: normalized.caseId, attempt: normalized.attempt, order },
  payload: normalized.payload,
  slotMap: normalized.slotMap,
})

const withOutput = (record: RunRecord, value: string): RunRecord => ({
  ...record,
  output: { kind: 'text', value },
})

const graded = (judgment: { kind: string }): GradedJudgment => {
  if (judgment.kind !== 'graded') {
    throw new Error(`expected a graded judgment, got ${judgment.kind}`)
  }
  return judgment as GradedJudgment
}

describe('what reaches the model', () => {
  // The blinding proof at the wire, not at the type: whatever the layers
  // above intended, this is the bytes the judge actually sees.
  it('sends nothing that names an arm', async () => {
    const leak = (record: RunRecord): RunRecord =>
      withOutput(
        record,
        `${record.variant.ref} ${record.variant.commit} ` +
          `${record.variant.model} ${record.runId} ${record.sweepId} ` +
          `${record.variant.configDigest}`,
      )
    const base = leak(BASE)
    const candidate = leak(CANDIDATE)
    const normalized = blindCase(base, candidate, X_IS_BASE)
    const { llm, calls } = fake([reply()])
    // A seat model deliberately unlike either arm's, so the assertion can
    // cover the whole request rather than only the message bodies: the
    // default seat happens to be the same model string the fixtures run
    // on, and a coincidence like that is how a leak hides.
    await judgeCase(llm, plan(normalized), {
      ...DEFAULT_JUDGE_CONFIG,
      panel: { seats: ['judge-seat-model'], temperature: 0 },
    })

    const wire = JSON.stringify(calls)
    for (const record of [base, candidate]) {
      for (const value of [
        record.variant.ref,
        record.variant.commit,
        record.variant.configDigest,
        record.variant.model,
        record.runId,
        record.sweepId,
      ]) {
        expect(JSON.stringify(record)).toContain(value)
        expect(wire).not.toContain(value)
      }
    }
  })

  it('never puts the slot map on the wire', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm, calls } = fake([reply()])
    await judgeCase(llm, plan(normalized), DEFAULT_JUDGE_CONFIG)
    const wire = JSON.stringify(calls)
    expect(wire).not.toContain('slotMap')
    // The mapping's content, not just its key name: "X is the candidate"
    // must not be reconstructable from anything sent.
    expect(wire).not.toMatch(/"?X"?\s*[:=]\s*"?(base|candidate)/)
  })

  it('tells the judge not to speak in terms of improvement', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm, calls } = fake([reply()])
    await judgeCase(llm, plan(normalized), DEFAULT_JUDGE_CONFIG)
    const system = calls[0]?.messages[0]?.content ?? ''
    expect(system).toMatch(/only in terms of X and Y/i)
    expect(system).toMatch(/labels are random/i)
  })

  it('uses the shape block that matches the agent', async () => {
    const chat = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const [bgBase, bgCandidate] = BACKGROUND_PAIR
    const background = blindCase(bgBase, bgCandidate, X_IS_BASE)
    const { llm, calls } = fake([reply()])
    await judgeCase(llm, plan(chat), DEFAULT_JUDGE_CONFIG)
    await judgeCase(llm, plan(background), DEFAULT_JUDGE_CONFIG)
    expect(calls[0]?.messages[0]?.content).toContain('conversational')
    expect(calls[1]?.messages[0]?.content).toContain('artifact')
  })

  // The dimension set is config, so a trace dimension switched on later
  // must reach the prompt without a code change.
  it('asks for exactly the configured dimensions', async () => {
    const config: JudgeConfig = {
      ...DEFAULT_JUDGE_CONFIG,
      dimensions: ['task_success', 'execution_quality'],
    }
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm, calls } = fake([
      reply({
        dimensions: {
          task_success: dim('X'),
          execution_quality: dim('X'),
        },
      }),
    ])
    await judgeCase(llm, plan(normalized), config)
    const user = calls[0]?.messages[1]?.content ?? ''
    expect(user).toContain('task_success, execution_quality')
    expect(user).not.toContain('user_utility')
  })

  it('pins one model per seat at the set temperature', async () => {
    const config: JudgeConfig = {
      ...DEFAULT_JUDGE_CONFIG,
      panel: { seats: ['model-a', 'model-b'], temperature: 0.2 },
    }
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm, calls } = fake([reply()])
    await judgeCase(llm, plan(normalized), config)
    // A list would let jsonCompletion fall back and both seats would
    // converge on the same first model, which is not a panel.
    expect(calls.map((c) => c.models)).toEqual([['model-a'], ['model-b']])
    expect(calls.map((c) => c.temperature)).toEqual([0.2, 0.2])
  })
})

describe('the verdict vocabulary', () => {
  it.each(['better', 'worse', 'BETTER', 'improved', 'candidate'])(
    'refuses %j as a verdict',
    (verdict) => {
      expect(
        CaseVerdictSchema.safeParse(reply({ overall: verdict })).success,
      ).toBe(false)
    },
  )

  it.each(['X', 'Y', 'tie', 'cannot_determine'])('accepts %j', (verdict) => {
    expect(
      CaseVerdictSchema.safeParse(reply({ overall: verdict })).success,
    ).toBe(true)
  })
})

describe('judgeCase', () => {
  it('returns the combined verdict per dimension plus overall', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([reply({ overall: 'Y' })])
    const result = graded(await judgeCase(llm, plan(normalized)))
    expect(result.dimensions[OVERALL]).toEqual({
      verdict: 'Y',
      magnitude: 'clear',
      seatsAgreed: true,
      directionConflict: false,
    })
    expect(result.dimensions.task_success?.verdict).toBe('Y')
    expect(result.slotMap).toEqual(normalized.slotMap)
  })

  it('carries no magnitude on a tie', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([reply({ overall: 'tie', magnitude: 'strong' })])
    const result = graded(await judgeCase(llm, plan(normalized)))
    expect(result.dimensions[OVERALL]?.magnitude).toBeNull()
  })

  // A judge failure is not a finding. Reported as ungraded so it can never
  // be read as a real CAN'T SAY about a real comparison.
  it('is ungraded when the model call throws', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([new Error('rate limited')])
    const result = await judgeCase(llm, plan(normalized))
    expect(result.kind).toBe('ungraded')
    expect(result.kind === 'ungraded' && result.reason).toContain(
      'rate limited',
    )
  })

  it('is ungraded when the reply does not fit the schema', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([{ nonsense: true }])
    expect((await judgeCase(llm, plan(normalized))).kind).toBe('ungraded')
  })

  it('is ungraded, naming the dimension, when one is missing', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([reply({ dimensions: { task_success: dim('X') } })])
    const result = await judgeCase(llm, plan(normalized))
    expect(result.kind === 'ungraded' && result.reason).toMatch(
      /instruction_adherence/,
    )
  })

  it('is ungraded when no seat is configured', async () => {
    const config: JudgeConfig = {
      ...DEFAULT_JUDGE_CONFIG,
      panel: { seats: [], temperature: 0 },
    }
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([reply()])
    expect((await judgeCase(llm, plan(normalized), config)).kind).toBe(
      'ungraded',
    )
  })

  it('keeps flags slot-keyed rather than guessing an arm', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([
      reply({
        flags: [
          {
            run: 'Y',
            type: 'restricted_data',
            loc: 'Y.final',
            explanation: 'named a voter',
          },
        ],
      }),
    ])
    const result = graded(await judgeCase(llm, plan(normalized)))
    expect(result.flags).toEqual([
      expect.objectContaining({ run: 'Y', type: 'restricted_data' }),
    ])
  })
})

describe('the panel', () => {
  const threeSeats: JudgeConfig = {
    ...DEFAULT_JUDGE_CONFIG,
    panel: { seats: ['a', 'b', 'c'], temperature: 0 },
  }

  it('takes a 2-of-3 majority and records the disagreement', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([
      reply({ overall: 'X' }),
      reply({ overall: 'X' }),
      reply({ overall: 'Y' }),
    ])
    const result = graded(await judgeCase(llm, plan(normalized), threeSeats))
    expect(result.dimensions[OVERALL]?.verdict).toBe('X')
    expect(result.dimensions[OVERALL]?.seatsAgreed).toBe(false)
    // Two seats named opposite slots, which is the disagreement the panel
    // gate is about.
    expect(result.dimensions[OVERALL]?.directionConflict).toBe(true)
    expect(result.seats).toHaveLength(3)
  })

  it('cannot determine when three seats say three things', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([
      reply({ overall: 'X' }),
      reply({ overall: 'Y' }),
      reply({ overall: 'tie' }),
    ])
    const result = graded(await judgeCase(llm, plan(normalized), threeSeats))
    expect(result.dimensions[OVERALL]?.verdict).toBe('cannot_determine')
  })

  // A strict majority, not a plurality. Two seats splitting is not a
  // majority of two, which is why the panel goes from one seat to three.
  it('cannot determine when two seats split', async () => {
    const config: JudgeConfig = {
      ...DEFAULT_JUDGE_CONFIG,
      panel: { seats: ['a', 'b'], temperature: 0 },
    }
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([reply({ overall: 'X' }), reply({ overall: 'Y' })])
    const result = graded(await judgeCase(llm, plan(normalized), config))
    expect(result.dimensions[OVERALL]?.verdict).toBe('cannot_determine')
  })

  // A seat that agrees on the winner but not on the strength is not a
  // direction conflict, so it must not count toward the panel gate.
  it('does not call a magnitude split a direction conflict', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([
      reply({ overall: 'X', magnitude: 'strong' }),
      reply({ overall: 'X', magnitude: 'slight' }),
      reply({ overall: 'tie' }),
    ])
    const result = graded(await judgeCase(llm, plan(normalized), threeSeats))
    expect(result.dimensions[OVERALL]?.seatsAgreed).toBe(false)
    expect(result.dimensions[OVERALL]?.directionConflict).toBe(false)
  })

  it('reports the least severe magnitude among the winning seats', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([
      reply({ overall: 'X', magnitude: 'strong' }),
      reply({ overall: 'X', magnitude: 'slight' }),
      reply({ overall: 'Y', magnitude: 'strong' }),
    ])
    const result = graded(await judgeCase(llm, plan(normalized), threeSeats))
    expect(result.dimensions[OVERALL]?.magnitude).toBe('slight')
  })
})

describe('the order-swap subsample', () => {
  const cases = (n: number): NormalizedCase[] =>
    Array.from({ length: n }, (_, i) =>
      blindCase(
        { ...BASE, caseId: `case-${i}`, runId: `b${i}` },
        { ...CANDIDATE, caseId: `case-${i}`, runId: `c${i}` },
        X_IS_BASE,
      ),
    )

  it('is empty when switched off', () => {
    const config: JudgeConfig = {
      ...DEFAULT_JUDGE_CONFIG,
      orderSwap: { enabled: false, fraction: 0.2 },
    }
    expect(selectSwapped(cases(10), config)).toHaveLength(0)
  })

  // Fixed, not random: the same case list picks the same pairs every run,
  // so one sweep's position-consistency number can be compared with the
  // last one's.
  it('picks the same fifth of the cases every time', () => {
    const picked = selectSwapped(cases(10)).map((c) => c.caseId)
    expect(picked).toEqual(['case-0', 'case-5'])
    expect(selectSwapped(cases(10)).map((c) => c.caseId)).toEqual(picked)
  })

  it('judges everything twice at a fraction of one', () => {
    const config: JudgeConfig = {
      ...DEFAULT_JUDGE_CONFIG,
      orderSwap: { enabled: true, fraction: 1 },
    }
    expect(selectSwapped(cases(4), config)).toHaveLength(4)
  })

  it('plans a primary for every case and a swap for the subsample', () => {
    const planned = planJudgments(cases(10))
    expect(planned.filter((p) => p.key.order === 'primary')).toHaveLength(10)
    const swapped = planned.filter((p) => p.key.order === 'swapped')
    expect(swapped.map((p) => p.key.caseId)).toEqual(['case-0', 'case-5'])
    // The swap has to carry the inverted map, or scoring would orient the
    // second order the same way as the first and measure nothing.
    for (const entry of swapped) {
      expect(entry.slotMap).toEqual({ X: 'candidate', Y: 'base' })
    }
  })

  it('judges every planned pair', async () => {
    const { llm, calls } = fake([reply()])
    const judgments = await judgeAll(llm, cases(5))
    expect(judgments).toHaveLength(6)
    expect(calls).toHaveLength(6)
  })
})

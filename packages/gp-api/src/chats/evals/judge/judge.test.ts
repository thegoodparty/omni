import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { JSONParseError, NoObjectGeneratedError, TypeValidationError } from 'ai'
import type { JsonJudgeModel } from '../../general/ordinance-flow/evals/coldJudge'
import type { LlmMessage } from '../../../llm/types/llmMessages.types'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { BACKGROUND_PAIR, CHAT_PAIR } from './fixtures/records'
import {
  CaseDimensionCollisionError,
  CaseVerdictSchema,
  caseVerdictSchemaFor,
  FLAG_TYPES,
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
  // THE CONSTRAINT THE MODEL WAS ACTUALLY GIVEN, as a predicate rather than
  // the schema object: `jsonCompletion` is generic, so `options.schema` is
  // `ZodType<T>` at the call site and cannot be stored as a concrete one.
  // Kept at all because the schema is the only thing that makes a model fill
  // in the dimensions, and swapping it for the permissive one is invisible
  // from a verdict — the open schema and the strict one both end in an
  // ungraded judgment, one via missingDimensions and one via a parse failure.
  schemaAccepts: (value: JsonValue) => boolean
  retries: number | undefined
}

// Mirrors what LlmService does: the service parses the model's JSON against
// the schema, so a reply that violates it must fail here the same way.
//
// AND IT MUST FAIL WITH THE SAME ERROR TYPE. The parse happens inside the AI
// SDK's generateObject, which does not surface a ZodError — it throws
// NoObjectGeneratedError. A fake that threw the ZodError instead let a test
// assert on a zod issue path and read as proof that the report names the
// missing dimension, which production never did.
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
          schemaAccepts: (value) => options.schema.safeParse(value).success,
          retries: options.retries,
        })
        const reply = replies[Math.min(index, replies.length - 1)]
        index += 1
        if (reply instanceof Error) throw reply
        const parsed = options.schema.safeParse(reply)
        if (!parsed.success) {
          throw new NoObjectGeneratedError({
            message: 'No object generated: response did not match schema.',
            text: JSON.stringify(reply),
            // A TYPE-VALIDATION cause, which is what the SDK attaches when
            // the model answered the wrong shape — and what separates that
            // from a truncated response. See the truncation fake below.
            cause: new TypeValidationError({
              value: reply,
              cause: parsed.error,
            }),
            finishReason: 'stop',
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              inputTokenDetails: {
                noCacheTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
              outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
            },
            response: { id: 'fake', timestamp: new Date(0), modelId: 'fake' },
          })
        }
        return { object: parsed.data, tokens: 0, model: 'fake' }
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

  // A probe planted something in the input, and a judge left to grade polish
  // prefers the run that read better while missing what was planted.
  it('tells an artifact judge a planted condition outranks polish', async () => {
    const [bgBase, bgCandidate] = BACKGROUND_PAIR
    const chat = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const background = blindCase(bgBase, bgCandidate, X_IS_BASE)
    const { llm, calls } = fake([reply()])
    await judgeCase(llm, plan(chat), DEFAULT_JUDGE_CONFIG)
    await judgeCase(llm, plan(background), DEFAULT_JUDGE_CONFIG)
    expect(calls[1]?.messages[0]?.content).toMatch(
      /"Condition:".*handled that condition.*reads better but ignores/s,
    )
    expect(calls[0]?.messages[0]?.content).not.toContain('Condition:')
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

  // NAMING THE RUBRIC, not the zod issue path. The schema now requires every
  // configured dimension, so a short verdict is rejected by the provider and
  // the only message available is "response did not match schema" — which
  // does not say which schema or what it wanted, and this sentence is what
  // the report prints. An earlier version of this test matched
  // /instruction_adherence/ against a ZodError dump and so passed while
  // production said nothing of the kind.
  it('is ungraded, naming what the rubric wanted, on a short verdict', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([reply({ dimensions: { task_success: dim('X') } })])
    const result = await judgeCase(llm, plan(normalized))
    const reason = result.kind === 'ungraded' ? result.reason : ''
    expect(reason).toContain('returned no verdict matching the rubric')
    for (const dimension of DEFAULT_JUDGE_CONFIG.dimensions) {
      expect(reason).toContain(dimension)
    }
    // Not the provider's own words, and not a zod dump: those are what this
    // sentence replaces.
    expect(reason).not.toContain('did not match schema')
  })

  // The other failures keep their own message. Calling a rate limit a rubric
  // problem would send the next reader to the wrong place entirely.
  it('leaves a non-schema failure saying what it was', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([new Error('rate limited by the provider')])
    const result = await judgeCase(llm, plan(normalized))
    const reason = result.kind === 'ungraded' ? result.reason : ''
    expect(reason).toContain('rate limited by the provider')
    expect(reason).not.toContain('matching the rubric')
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

// The rubric doc's flag list, enforced. A free-text type let one finding
// arrive under two names, so a flag count did not compare run to run.
describe('the flag vocabulary', () => {
  const flagged = (type: string): JsonValue =>
    reply({
      flags: [{ run: 'X', type, loc: 'X.final', explanation: 'why' }],
    })

  it('names every flag type in the prompt', async () => {
    const { llm, calls } = fake([reply()])
    await judgeCase(llm, plan(blindCase(BASE, CANDIDATE, X_IS_BASE)))
    const user = calls[0]?.messages[1]?.content ?? ''
    expect(user).toContain(`types: ${FLAG_TYPES.join(', ')}.`)
  })

  it('shows the model the list in the schema it fills', () => {
    const schema = JSON.stringify(
      z.toJSONSchema(caseVerdictSchemaFor(DEFAULT_JUDGE_CONFIG.dimensions)),
    )
    expect(schema).toContain(JSON.stringify(FLAG_TYPES))
  })

  // Anthropic's tool mode does not enforce an enum, so an invented type does
  // arrive, and refusing it would throw away the seat's whole verdict.
  it('keeps the verdict and replaces an invented type', async () => {
    const { llm } = fake([flagged('name error inherited')])
    const result = await judgeCase(
      llm,
      plan(blindCase(BASE, CANDIDATE, X_IS_BASE)),
    )
    const judgment = graded(result)
    expect(judgment.flags.map((f) => f.type)).toEqual(['other_severe'])
    expect(JSON.stringify(judgment)).not.toContain('name error inherited')
  })

  it('replaces an invented type on a stored verdict too', () => {
    const parsed = CaseVerdictSchema.parse(flagged('name error propagated'))
    expect(parsed.flags?.map((f) => f.type)).toEqual(['other_severe'])
    expect(
      CaseVerdictSchema.parse(flagged('fabricated_source')).flags?.[0]?.type,
    ).toBe('fabricated_source')
  })
})

describe('an ungraded judgment', () => {
  it('keeps the slot map, so its stored ruling names the arms', async () => {
    const config: JudgeConfig = {
      ...DEFAULT_JUDGE_CONFIG,
      panel: { seats: [], temperature: 0 },
    }
    const planned = plan(blindCase(BASE, CANDIDATE, X_IS_BASE))
    const { llm } = fake([reply()])
    const result = await judgeCase(llm, planned, config)
    expect(result).toMatchObject({
      kind: 'ungraded',
      slotMap: planned.slotMap,
    })
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

  // One seat's 429 used to abandon the seats already collected and paid
  // for, so a three-seat panel lost two clean verdicts and `modal` never
  // got the majority the panel exists to produce.
  it('keeps the seats that answered when one seat throws', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([
      reply({ overall: 'X' }),
      reply({ overall: 'X' }),
      new Error('rate limited'),
    ])
    const result = graded(await judgeCase(llm, plan(normalized), threeSeats))
    expect(result.seats).toHaveLength(2)
    expect(result.dimensions[OVERALL]?.verdict).toBe('X')
    // A degraded panel has to be visible rather than silent.
    expect(result.seatFailures).toEqual([
      { model: 'c', message: 'rate limited' },
    ])
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

  // A floor is not put to a majority. One seat calling a run unacceptable
  // is a finding about that run, and reading seats[0] alone dropped it
  // before scoring ever saw it.
  it('takes a floor failure from any seat, not only the first', async () => {
    const normalized = blindCase(BASE, CANDIDATE, X_IS_BASE)
    const { llm } = fake([
      reply({ floor: { X_acceptable: 'yes', Y_acceptable: 'yes' } }),
      reply({
        floor: {
          X_acceptable: 'no',
          Y_acceptable: 'unclear',
          note: 'X invented a source',
        },
      }),
      reply({ floor: { X_acceptable: 'yes', Y_acceptable: 'yes' } }),
    ])
    const result = graded(await judgeCase(llm, plan(normalized), threeSeats))
    expect(result.absoluteFloor).toEqual({
      X_acceptable: 'no',
      Y_acceptable: 'unclear',
      note: 'X invented a source',
    })
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

// WHAT THE FIRST LIVE SWEEP COULD NOT CATCH, and what cost it 29 ungraded
// judgments. `CaseVerdictSchema` declares `dimensions` as an open
// `z.record`, which as a structured-output constraint means "arbitrary keys,
// none required" — so the model satisfied it with `{}`, put everything in
// `overall`, and every seat threw. The prose prompt named the three
// dimensions and lost, because a schema is a constraint and prose is a
// request. Nothing in the suite noticed: every fake judge in it returns a
// full verdict, so the schema was never the thing under test.
describe('caseVerdictSchemaFor', () => {
  const dims = ['task_success', 'instruction_adherence', 'user_utility']
  const dimension = { reasoning: 'r', verdict: 'tie' }
  const verdict = (dimensions: Record<string, typeof dimension>) => ({
    rubric_version: 'uj-rubric-0.2',
    dimensions,
    overall: { reasoning: 'r', verdict: 'tie' },
  })

  it('refuses an empty dimensions object', () => {
    // The open record ACCEPTS this, which is the whole bug. Asserted against
    // the permissive schema too, so the difference between them is the thing
    // under test rather than an implementation detail.
    expect(CaseVerdictSchema.safeParse(verdict({})).success).toBe(true)
    expect(caseVerdictSchemaFor(dims).safeParse(verdict({})).success).toBe(
      false,
    )
  })

  it.each(dims)('refuses a verdict missing %s', (missing) => {
    const present = Object.fromEntries(
      dims.filter((d) => d !== missing).map((d) => [d, dimension]),
    )
    expect(caseVerdictSchemaFor(dims).safeParse(verdict(present)).success).toBe(
      false,
    )
  })

  it('accepts a verdict naming every configured dimension', () => {
    const all = Object.fromEntries(dims.map((d) => [d, dimension]))
    expect(caseVerdictSchemaFor(dims).safeParse(verdict(all)).success).toBe(
      true,
    )
  })

  // Derived from the config, so a dimension added there is required of the
  // model without a second edit here.
  it('requires whatever the config names, not a hardcoded three', () => {
    const schema = caseVerdictSchemaFor(['only_this_one'])
    const all = Object.fromEntries(dims.map((d) => [d, dimension]))
    expect(schema.safeParse(verdict(all)).success).toBe(false)
    expect(
      schema.safeParse(verdict({ only_this_one: dimension })).success,
    ).toBe(true)
  })
})

// The hop from `caseVerdictSchemaFor` to the model call. The schema tests
// above prove the strict schema refuses an empty dimensions object; this is
// what proves the judge hands that schema to the model rather than the
// permissive one it sits beside. Reverting that single line reintroduces the
// defect that left the first live sweep with 29 ungraded judgments, and
// without this the whole suite stays green while it does.
describe('the seat is constrained by the strict schema', () => {
  const emptyDimensions = {
    rubric_version: 'uj-rubric-0.2',
    dimensions: {},
    overall: { reasoning: 'r', verdict: 'tie' },
  }

  it('gives the model a schema that refuses empty dimensions', async () => {
    const { llm, calls } = fake([reply({ overall: 'tie' })])
    await judgeCase(llm, plan(blindCase(BASE, CANDIDATE, X_IS_BASE)))
    expect(calls).toHaveLength(1)
    const accepts = calls[0]?.schemaAccepts
    expect(accepts).toBeDefined()
    expect(accepts?.(emptyDimensions)).toBe(false)
  })

  it('requires every dimension the config names', async () => {
    const config: JudgeConfig = {
      ...DEFAULT_JUDGE_CONFIG,
      dimensions: ['task_success'],
    }
    const { llm, calls } = fake([reply({ overall: 'tie' })])
    await judgeCase(llm, plan(blindCase(BASE, CANDIDATE, X_IS_BASE)), config)
    const accepts = calls[0]?.schemaAccepts
    expect(
      accepts?.({
        ...emptyDimensions,
        dimensions: { task_success: { reasoning: 'r', verdict: 'tie' } },
      }),
    ).toBe(true)
    expect(accepts?.(emptyDimensions)).toBe(false)
  })
})

// THE RETRY BUDGET ON A PAID PATH. LlmService defaults to 3, which is four
// calls and about ten seconds of backoff per seat. A verdict the rubric
// schema rejects is not a transient failure — the panel runs at temperature 0
// over a byte-identical prompt, so a retry re-asks a question already
// answered the same way, and three of them multiply a systematic
// non-compliance by four across every pair and every seat.
describe('a seat does not inherit the service retry budget', () => {
  it('asks for one retry, not the default', async () => {
    const { llm, calls } = fake([reply({ overall: 'tie' })])
    await judgeCase(llm, plan(blindCase(BASE, CANDIDATE, X_IS_BASE)))
    expect(calls).toHaveLength(1)
    // Stated rather than left to the service: omitting it is what costs the
    // four calls, and an omission reads identically to a deliberate 3.
    expect(calls[0]?.retries).toBe(1)
  })
})

// A DIMENSION NAME THAT IS ALSO AN OBJECT KEY. `o['__proto__'] = x` sets the
// prototype instead of defining an own property, so a schema shape built by
// assignment would carry no key for this one name — and `z.object` would then
// accept `dimensions: {}` again, which is the defect this whole change
// exists to close, reintroduced for exactly one name. Both guards fail
// together: `verdict.dimensions['__proto__']` also resolves off the
// prototype chain rather than being undefined.
describe('caseVerdictSchemaFor is not confused by an object key', () => {
  it.each(['__proto__', 'constructor', 'toString'])(
    'still requires a dimension named %s',
    (name) => {
      const schema = caseVerdictSchemaFor([name])
      const verdict = (dimensions: JsonValue) => ({
        rubric_version: 'uj-rubric-0.2',
        dimensions,
        overall: { reasoning: 'r', verdict: 'tie' },
      })
      expect(schema.safeParse(verdict({})).success).toBe(false)
      expect(
        schema.safeParse(
          verdict({ [name]: { reasoning: 'r', verdict: 'tie' } }),
        ).success,
      ).toBe(true)
    },
  )
})

// The reason reaches a PR comment and the job summary from a path that makes
// real model calls, so it goes through the same scrubber the arm manifests
// use. Asserted here rather than trusted from sweepArm's own tests, because
// this is a second caller of it and the one nothing covered.
describe('an ungraded reason is scrubbed', () => {
  it('redacts a secret the provider echoed back', async () => {
    const secret = process.env.ANTHROPIC_API_KEY
    expect(secret).toBeDefined()
    const { llm } = fake([new Error(`provider rejected key ${secret}`)])
    const result = await judgeCase(
      llm,
      plan(blindCase(BASE, CANDIDATE, X_IS_BASE)),
    )
    const reason = result.kind === 'ungraded' ? result.reason : ''
    expect(reason).not.toContain(secret)
    expect(reason).toContain('[redacted ANTHROPIC_API_KEY]')
    // The sentence survives: a redaction that ate the message would make the
    // report useless in a different way.
    expect(reason).toContain('provider rejected key')
  })
})

// ONE ERROR TYPE, SEVERAL FAILURES. The SDK raises NoObjectGeneratedError for
// a verdict that broke the schema, for a response truncated mid-JSON, for an
// empty one and for a content filter. Measured against the real provider with
// maxOutputTokens 16: finishReason `length`, cause a JSONParseError, message
// "No object generated: could not parse the response." Those numbers are
// where this fixture comes from.
describe('a truncated response is not called a rubric failure', () => {
  const truncated = (): Error =>
    new NoObjectGeneratedError({
      message: 'No object generated: could not parse the response.',
      text: '{"rubric_version":"uj-rub',
      cause: new JSONParseError({
        text: '{"rubric_version":"uj-rub',
        cause: new Error('Unexpected end of JSON input'),
      }),
      finishReason: 'length',
      usage: {
        inputTokens: 0,
        outputTokens: 16,
        totalTokens: 16,
        inputTokenDetails: {
          noCacheTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        outputTokenDetails: { textTokens: 16, reasoningTokens: 0 },
      },
      response: { id: 'fake', timestamp: new Date(0), modelId: 'fake' },
    })

  it('says the response was unreadable and names the finish reason', async () => {
    const { llm } = fake([truncated()])
    const result = await judgeCase(
      llm,
      plan(blindCase(BASE, CANDIDATE, X_IS_BASE)),
    )
    const reason = result.kind === 'ungraded' ? result.reason : ''
    expect(reason).toContain('produced no readable verdict')
    // The actionable part: max_tokens, not the rubric.
    expect(reason).toContain('finish reason: length')
  })

  // THE BLOCKER THIS TEST EXISTS FOR. Renaming every
  // NoObjectGeneratedError sent a reader to the rubric for a problem that
  // was in the token budget.
  it('does not blame the rubric for it', async () => {
    const { llm } = fake([truncated()])
    const result = await judgeCase(
      llm,
      plan(blindCase(BASE, CANDIDATE, X_IS_BASE)),
    )
    const reason = result.kind === 'ungraded' ? result.reason : ''
    expect(reason).not.toContain('matching the rubric')
    for (const dimension of DEFAULT_JUDGE_CONFIG.dimensions) {
      expect(reason).not.toContain(dimension)
    }
  })
})

// A probe asks about a relationship between the artifact and the input it
// mutated, which the three default dimensions do not. The case's own question
// has to reach the prompt, be required by the schema the seat is held to, and
// come back combined — or the judge is asked it in prose and answers nothing.
describe('a case with dimensions of its own', () => {
  const sparse = {
    name: 'sparse_input_handling',
    question: 'Does the run say which opponents had too little to summarize?',
  }
  const withSparse = (): NormalizedCase => {
    const normalized = blindCase(
      BACKGROUND_PAIR[0],
      BACKGROUND_PAIR[1],
      X_IS_BASE,
    )
    return {
      ...normalized,
      payload: { ...normalized.payload, caseDimensions: [sparse] },
    }
  }
  const sparseReply = (verdict: string): JsonValue =>
    reply({
      dimensions: {
        task_success: dim('tie', null),
        instruction_adherence: dim('tie', null),
        user_utility: dim('X'),
        sparse_input_handling: dim(verdict),
      },
    })

  it('puts the question in the rubric and the name in the list', async () => {
    const { llm, calls } = fake([sparseReply('Y')])
    await judgeCase(llm, plan(withSparse()), DEFAULT_JUDGE_CONFIG)
    const prompt = calls[0]?.messages[1]?.content
    expect(prompt).toContain(
      'dimensions: task_success, instruction_adherence, user_utility, ' +
        'sparse_input_handling.',
    )
    expect(prompt).toContain(`- sparse_input_handling: ${sparse.question}`)
  })

  it('holds the seat to answering it', async () => {
    const { llm, calls } = fake([sparseReply('Y')])
    await judgeCase(llm, plan(withSparse()), DEFAULT_JUDGE_CONFIG)
    expect(calls[0]?.schemaAccepts(reply())).toBe(false)
    expect(calls[0]?.schemaAccepts(sparseReply('Y'))).toBe(true)
  })

  it('combines it beside the defaults', async () => {
    const { llm } = fake([sparseReply('Y')])
    const judgment = graded(
      await judgeCase(llm, plan(withSparse()), DEFAULT_JUDGE_CONFIG),
    )
    expect(judgment.dimensions.sparse_input_handling?.verdict).toBe('Y')
    expect(judgment.dimensions.user_utility?.verdict).toBe('X')
  })

  it('survives the order swap', () => {
    const swapped = planJudgments([withSparse()], {
      ...DEFAULT_JUDGE_CONFIG,
      orderSwap: { enabled: true, fraction: 1 },
    }).find((p) => p.key.order === 'swapped')
    expect(swapped?.payload.caseDimensions).toEqual([sparse])
  })

  // The case list only knows the default config. A config judging on other
  // names has to refuse a case that reuses one, before any seat is paid.
  it('refuses a name the active config already judges on', async () => {
    const { llm, calls } = fake([sparseReply('Y')])
    const config: JudgeConfig = {
      ...DEFAULT_JUDGE_CONFIG,
      dimensions: [...DEFAULT_JUDGE_CONFIG.dimensions, sparse.name],
    }
    await expect(judgeCase(llm, plan(withSparse()), config)).rejects.toThrow(
      CaseDimensionCollisionError,
    )
    await expect(judgeCase(llm, plan(withSparse()), config)).rejects.toThrow(
      /meeting_briefing\/brief-2025-11-04 asks sparse_input_handling/,
    )
    expect(calls).toHaveLength(0)
  })

  it('leaves a case without them asking exactly what it asked before', async () => {
    const { llm, calls } = fake([reply()])
    await judgeCase(
      llm,
      plan(blindCase(BACKGROUND_PAIR[0], BACKGROUND_PAIR[1], X_IS_BASE)),
      DEFAULT_JUDGE_CONFIG,
    )
    const prompt = calls[0]?.messages[1]?.content ?? ''
    expect(prompt).toContain(
      'dimensions: task_success, instruction_adherence, user_utility. Then',
    )
    expect(prompt).not.toContain('This case was written to test')
  })
})

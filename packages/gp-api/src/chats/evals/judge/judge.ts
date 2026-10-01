import { z } from 'zod'
import { NoObjectGeneratedError, TypeValidationError } from 'ai'
import type { JsonJudgeModel } from '../../general/ordinance-flow/evals/coldJudge'
import type { LlmMessage } from '../../../llm/types/llmMessages.types'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import type { JudgePayload, NormalizedCase, SlotMap } from './normalize'
import { withSwappedSlots } from './normalize'
import { scrubReason } from './sweepArm'

// Runs the blind comparison.
//
// The judge is told about X and Y and nothing else. It never learns which
// arm is the candidate, and its vocabulary has no BETTER or WORSE in it —
// only a slot, a tie, or an admission that it cannot tell. Turning a slot
// into a direction is scoring's job, after the fact, with a slot map this
// module is never handed.
//
// v1 judges FINAL OUTPUTS ONLY. The trace is in the record and stays out of
// the payload, so trace dimensions switch on by adding them to
// config.dimensions and extending the normalizer's renderer, and stored
// records re-grade at zero agent cost.

// The wire schema, in the rubric doc's own snake_case, so the prompt and
// the parser cannot drift apart. See the rubric doc section 6.
export const SlotVerdictSchema = z.enum(['X', 'Y', 'tie', 'cannot_determine'])
export type SlotVerdict = z.infer<typeof SlotVerdictSchema>

export const MagnitudeSchema = z.enum(['slight', 'clear', 'strong'])
export type Magnitude = z.infer<typeof MagnitudeSchema>

const EvidenceSchema = z.object({
  loc: z.string(),
  quote: z.string(),
  note: z.string().optional(),
})

const DimensionVerdictSchema = z.object({
  reasoning: z.string(),
  evidence: z.array(EvidenceSchema).optional(),
  verdict: SlotVerdictSchema,
  magnitude: MagnitudeSchema.nullish(),
  needed_to_decide: z.string().nullish(),
})
export type DimensionVerdict = z.infer<typeof DimensionVerdictSchema>

const OverallVerdictSchema = DimensionVerdictSchema.extend({
  overall_tradeoff: z.boolean().optional(),
  tradeoff_note: z.string().nullish(),
})

const FlagSchema = z.object({
  run: z.enum(['X', 'Y']),
  type: z.string(),
  loc: z.string().optional(),
  quote: z.string().optional(),
  explanation: z.string(),
})
export type Flag = z.infer<typeof FlagSchema>

const AcceptabilitySchema = z.enum(['yes', 'no', 'unclear'])
type Acceptability = z.infer<typeof AcceptabilitySchema>

// Small and load-bearing: a pairwise judge returns `tie` when both runs are
// bad, and without this a SAME verdict can hide "same, and both broken".
const AbsoluteFloorSchema = z.object({
  X_acceptable: AcceptabilitySchema,
  Y_acceptable: AcceptabilitySchema,
  note: z.string().optional(),
})
export type AbsoluteFloor = z.infer<typeof AbsoluteFloorSchema>

export const CaseVerdictSchema = z.object({
  rubric_version: z.string(),
  shared_observations: z.string().optional(),
  dimensions: z.record(z.string(), DimensionVerdictSchema),
  overall: OverallVerdictSchema,
  flags: z.array(FlagSchema).optional(),
  absolute_floor: AbsoluteFloorSchema.optional(),
})
export type CaseVerdict = z.infer<typeof CaseVerdictSchema>

// THE SCHEMA THE MODEL IS GIVEN, and it cannot be the one above. An open
// `z.record` compiles to a JSON Schema object with arbitrary keys and nothing
// required, so a model constrained by it satisfies `dimensions` with `{}` and
// puts everything in `overall` — which is exactly what the first live sweep
// got, on all 29 judgments. The prose prompt names the dimensions too, and
// lost: a schema is a constraint and prose is a request.
//
// Named keys, derived from the same `config.dimensions` the prompt and
// `missingDimensions` read, so the three cannot drift apart. Kept separate
// from `CaseVerdictSchema` because that one is the shape of a verdict anybody
// may hold, including a canned one, while this is the shape one particular
// panel must be made to return.
export const caseVerdictSchemaFor = (
  dimensions: readonly string[],
): z.ZodType<CaseVerdict> => {
  // Object.fromEntries, not an assignment into a literal. `o['__proto__'] = x`
  // sets the prototype instead of creating an own property, so `z.object`
  // would see no key for that one name and accept `dimensions: {}` again —
  // this bug, reintroduced for exactly one dimension name. fromEntries
  // defines an own property whatever the key is.
  const shape: Record<string, typeof DimensionVerdictSchema> =
    Object.fromEntries(dimensions.map((d) => [d, DimensionVerdictSchema]))
  return z.object({
    rubric_version: z.string(),
    shared_observations: z.string().optional(),
    dimensions: z.object(shape),
    overall: OverallVerdictSchema,
    flags: z.array(FlagSchema).optional(),
    absolute_floor: AbsoluteFloorSchema.optional(),
  })
}

// The key scoring joins on. Never sent to the model.
export const OVERALL = 'overall'

export type JudgmentOrder = 'primary' | 'swapped'

export interface JudgmentKey {
  caseId: string
  attempt: number
  order: JudgmentOrder
}

export interface PlannedJudgment {
  key: JudgmentKey
  payload: JudgePayload
  // Kept beside the payload for scoring, and never read by this module's
  // model call.
  slotMap: SlotMap
}

export interface SeatVerdict {
  model: string
  verdict: CaseVerdict
}

// One seat that threw. Held as its two parts rather than a preformatted
// line because the report names WHICH seat a panel lost, and recovering a
// model name out of `model: message` breaks the first time a message
// contains a colon of its own.
export interface SeatFailure {
  model: string
  message: string
}

export interface CombinedDimension {
  verdict: SlotVerdict
  magnitude: Magnitude | null
  // False when the seats split at all, including X against tie. With one
  // seat this is always true.
  seatsAgreed: boolean
  // Narrower, and the one the panel gate uses: two seats named OPPOSITE
  // slots. The rubric doc gates on seats disagreeing about direction, which
  // is not the same as disagreeing about strength. Always false with one
  // seat. Within a judgment every seat saw the same slots, so X against Y
  // across seats is a direction conflict with no orientation needed.
  directionConflict: boolean
}

export interface GradedJudgment {
  kind: 'graded'
  key: JudgmentKey
  slotMap: SlotMap
  // Keyed by dimension name, plus OVERALL.
  dimensions: Readonly<Record<string, CombinedDimension>>
  seats: readonly SeatVerdict[]
  // Seats that threw, one entry each. A panel that lost a seat still
  // produced a comparison, but it produced it on fewer opinions than the
  // config asked for, and that has to be visible rather than silent.
  seatFailures: readonly SeatFailure[]
  flags: readonly Flag[]
  absoluteFloor: AbsoluteFloor | null
}

// A judge failure is not a verdict. It is reported as ungraded, apart from
// CAN'T SAY, which is a real finding about a real comparison.
export interface UngradedJudgment {
  kind: 'ungraded'
  key: JudgmentKey
  reason: string
}

export type Judgment = GradedJudgment | UngradedJudgment

// ---------------------------------------------------------------------------
// Prompt text. OWNED BY THE RUBRIC DOC, not by this module — the machinery
// below feeds and runs it, and the wording is edited here to match the doc
// rather than reasoned about locally.
// https://goodparty.clickup.com/90132012119/docs/2ky4jq2q-154253/2ky4jq2q-139173
// ---------------------------------------------------------------------------

export const RUBRIC_VERSION = 'uj-rubric-0.2'

const SHAPE_BLOCKS: Readonly<Record<string, string>> = {
  chat: [
    'AGENT SHAPE: conversational. The user input is identical across X and',
    'Y; only the agent replies differ. Where a tool failed or returned',
    'partial data, look at whether the reply tells the user.',
  ].join(' '),
  background: [
    'AGENT SHAPE: artifact. The final output is a structured artifact.',
    'Compare content, coverage, synthesis and sourcing. Do not judge schema',
    'validity or whether citation ids resolve; those are checked',
    'mechanically. Do judge whether cited sources support the claims',
    'attached to them, whether the artifact adds claims that appear in no',
    'source, and whether it uses its declared fallback when inputs are',
    'insufficient instead of inventing content.',
  ].join(' '),
}

const buildSystemPrompt = (shape: string): string =>
  [
    'You are an evaluator comparing two recorded runs of the same AI agent',
    'on the same input. The runs are labeled X and Y. The labels are random',
    'and say nothing about which run is older, newer, preferred, or produced',
    'by which model. Do not try to infer which is which.',
    '',
    'For each rubric dimension, decide whether X is better, Y is better,',
    'they are tied, or the evidence does not allow a call. Then give an',
    'overall comparison. You are giving directional evidence to engineers.',
    'You are not deciding whether either run is safe to ship.',
    '',
    'Answer only in terms of X and Y. Never say better-than-baseline,',
    'improved, or regressed: you do not know which run is which and any',
    'such claim would be guesswork.',
    '',
    SHAPE_BLOCKS[shape] ?? '',
  ].join('\n')

const buildUserPrompt = (
  payload: JudgePayload,
  dimensions: readonly string[],
): string => {
  const [x, y] = payload.runs
  return [
    `<agent_id>${payload.agentId}</agent_id>`,
    '',
    '<shared_input>',
    payload.sharedInput,
    '</shared_input>',
    '',
    `<run id="${x.id}"><final_output>`,
    x.finalOutput,
    '</final_output></run>',
    '',
    `<run id="${y.id}"><final_output>`,
    y.finalOutput,
    '</final_output></run>',
    '',
    '<rubric>',
    'Give a verdict and, when not a tie, a magnitude for each of these',
    `dimensions: ${dimensions.join(', ')}. Then give an overall verdict,`,
    'which is holistic rather than an average. Magnitudes: slight (a',
    'careful reviewer would notice), clear (the user would notice and it',
    'would change their trust or their workload), strong (one run fails at',
    'something the other handles).',
    '</rubric>',
    '',
    '<evidence_locations>',
    `Cite evidence by location: ${x.id}.final, ${y.id}.final, or input.`,
    '</evidence_locations>',
    `<rubric_version>${RUBRIC_VERSION}</rubric_version>`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Machinery
// ---------------------------------------------------------------------------

export const buildMessages = (
  payload: JudgePayload,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): LlmMessage[] => [
  { role: 'system', content: buildSystemPrompt(payload.agentShape) },
  { role: 'user', content: buildUserPrompt(payload, config.dimensions) },
]

// Deterministic on purpose: the subsample is described as fixed, so the same
// case list picks the same pairs on every run and a position-consistency
// number can be compared with the one before it.
export const selectSwapped = (
  cases: readonly NormalizedCase[],
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): NormalizedCase[] => {
  const { enabled, fraction } = config.orderSwap
  if (!enabled || fraction <= 0 || cases.length === 0) return []
  const stride = Math.max(1, Math.round(1 / fraction))
  return [...cases]
    .sort((a, b) =>
      a.caseId === b.caseId
        ? a.attempt - b.attempt
        : a.caseId.localeCompare(b.caseId),
    )
    .filter((_, index) => index % stride === 0)
}

export const planJudgments = (
  cases: readonly NormalizedCase[],
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): PlannedJudgment[] => {
  const primary = cases.map((c) => ({
    key: { caseId: c.caseId, attempt: c.attempt, order: 'primary' as const },
    payload: c.payload,
    slotMap: c.slotMap,
  }))
  const swapped = selectSwapped(cases, config).map((c) => {
    const flipped = withSwappedSlots(c)
    return {
      key: {
        caseId: c.caseId,
        attempt: c.attempt,
        order: 'swapped' as const,
      },
      payload: flipped.payload,
      slotMap: flipped.slotMap,
    }
  })
  return [...primary, ...swapped]
}

const modal = (
  values: readonly SlotVerdict[],
): { verdict: SlotVerdict; agreed: boolean } => {
  const counts = new Map<SlotVerdict, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  let best: SlotVerdict = 'cannot_determine'
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  // A strict majority, not a plurality. Two seats splitting is not a
  // majority of two, which is why the panel starts at one seat and grows to
  // three rather than to two.
  const majority = bestCount * 2 > values.length
  return {
    verdict: majority ? best : 'cannot_determine',
    agreed: counts.size === 1,
  }
}

// The magnitude of the seats that voted for the winning verdict, taken as
// the least severe of them. Magnitude is reported as a distribution and
// never enters the score: calibration across judge families does not exist
// yet, so weighting by it would add an unvalidated assumption to the
// primary statistic.
const ORDER: readonly Magnitude[] = ['slight', 'clear', 'strong']

const leastMagnitude = (
  magnitudes: readonly (Magnitude | null | undefined)[],
): Magnitude | null => {
  const present = magnitudes.filter((m): m is Magnitude => m != null)
  if (present.length === 0) return null
  return present.reduce((acc, m) =>
    ORDER.indexOf(m) < ORDER.indexOf(acc) ? m : acc,
  )
}

// The floor is not put to a majority the way a dimension verdict is. One
// seat calling a run unacceptable is a finding about that run, and a panel
// that outvoted it has not made the run acceptable — so the combined floor
// takes the least acceptable answer any seat gave.
const worstAcceptable = (values: readonly Acceptability[]): Acceptability =>
  values.includes('no') ? 'no' : values.includes('unclear') ? 'unclear' : 'yes'

const combineFloor = (seats: readonly SeatVerdict[]): AbsoluteFloor | null => {
  const floors = seats
    .map((s) => s.verdict.absolute_floor)
    .filter((f): f is AbsoluteFloor => f !== undefined)
  if (floors.length === 0) return null
  const notes = [
    ...new Set(
      floors
        .map((f) => f.note)
        .filter((n): n is string => n !== undefined && n.length > 0),
    ),
  ]
  return {
    X_acceptable: worstAcceptable(floors.map((f) => f.X_acceptable)),
    Y_acceptable: worstAcceptable(floors.map((f) => f.Y_acceptable)),
    ...(notes.length === 0 ? {} : { note: notes.join(' | ') }),
  }
}

const dimensionOf = (
  verdict: CaseVerdict,
  dimension: string,
): DimensionVerdict | undefined =>
  dimension === OVERALL ? verdict.overall : verdict.dimensions[dimension]

const combine = (
  seats: readonly SeatVerdict[],
  dimensions: readonly string[],
): Record<string, CombinedDimension> => {
  const combined: Record<string, CombinedDimension> = {}
  for (const dimension of [...dimensions, OVERALL]) {
    const found = seats
      .map((s) => dimensionOf(s.verdict, dimension))
      .filter((d): d is DimensionVerdict => d !== undefined)
    const verdicts = found.map((d) => d.verdict)
    const { verdict, agreed } = modal(verdicts)
    const named = new Set(verdicts.filter((v) => v === 'X' || v === 'Y'))
    combined[dimension] = {
      verdict,
      magnitude:
        verdict === 'tie' || verdict === 'cannot_determine'
          ? null
          : leastMagnitude(
              found
                .filter((d) => d.verdict === verdict)
                .map((d) => d.magnitude),
            ),
      seatsAgreed: agreed,
      directionConflict: named.size > 1,
    }
  }
  return combined
}

// LlmService defaults to 3, which costs four paid calls and about ten
// seconds of backoff before a seat gives up. That budget exists for a
// transient failure, and a verdict rejected by the rubric schema is not one:
// the panel runs at temperature 0 over a byte-identical prompt, so the
// retries re-ask a question already answered the same way. One retry still
// absorbs a network blip; three multiply a systematic non-compliance by four
// across every pair and every seat.
const SEAT_RETRIES = 1

// One seat, one pinned model. Passing a list would let jsonCompletion fall
// back down a shared default and every seat would converge on the same
// first model, which is not a panel.
const runSeat = async (
  llm: JsonJudgeModel,
  payload: JudgePayload,
  model: string,
  config: JudgeConfig,
): Promise<SeatVerdict> => {
  try {
    const { object } = await llm.jsonCompletion({
      messages: buildMessages(payload, config),
      schema: caseVerdictSchemaFor(config.dimensions),
      models: [model],
      temperature: config.panel.temperature,
      retries: SEAT_RETRIES,
    })
    return { model, verdict: object }
  } catch (err) {
    // Auth, rate limits, network: their own message already says what
    // happened.
    if (!NoObjectGeneratedError.isInstance(err)) throw err

    // ONE ERROR TYPE, SEVERAL DIFFERENT FAILURES, and only one of them is
    // about the rubric. The SDK raises NoObjectGeneratedError for a verdict
    // that broke the schema, for a response truncated mid-JSON, for an empty
    // one and for a content filter. Measured on a truncation: finishReason
    // `length`, cause a JSONParseError, message "could not parse the
    // response". So the cause is what separates them — a type-validation
    // failure is the model answering the wrong shape, anything else is the
    // response never arriving intact.
    //
    // The distinction is the whole value of renaming at all. Telling someone
    // their rubric was not satisfied when the real problem was max_tokens
    // sends them to the prompt for an answer that is in the finish reason.
    if (!TypeValidationError.isInstance(err.cause)) {
      throw new Error(
        `seat ${model} produced no readable verdict (finish reason: ` +
          `${err.finishReason}): ${err.message}`,
      )
    }
    throw new Error(
      `seat ${model} returned no verdict matching the rubric, which ` +
        `requires one per dimension: ${config.dimensions.join(', ')}`,
    )
  }
}

// Takes the payload and the key, never a NormalizedCase: the slot map is
// not reachable from here, so there is no code path that could put it on
// the wire.
export const judgeCase = async (
  llm: JsonJudgeModel,
  planned: PlannedJudgment,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): Promise<Judgment> => {
  const seats: SeatVerdict[] = []
  const seatFailures: SeatFailure[] = []
  for (const model of config.panel.seats) {
    try {
      seats.push(await runSeat(llm, planned.payload, model, config))
    } catch (err) {
      // Collected, not returned. Returning here on the first failure threw
      // away every seat already collected and paid for, so one 429 on the
      // last of three seats binned two clean verdicts and left `modal`
      // without the majority the panel exists to produce.
      seatFailures.push({
        model,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (seats.length === 0) {
    // No seat answered, so there is no comparison: ungraded rather than a
    // CAN'T SAY, since conflating the two would let a broken judge read as
    // a genuine finding of equivalence.
    return {
      kind: 'ungraded',
      key: planned.key,
      // Scrubbed HERE rather than at the report, so every future reader of a
      // Judgment.reason gets it. These messages come off a path that makes
      // real model calls, and the reason reaches a PR comment and the job
      // summary — see SECRET_VARS.
      reason: scrubReason(
        seatFailures.length === 0
          ? 'no judge seats configured'
          : seatFailures.map((f) => `${f.model}: ${f.message}`).join('; '),
      ),
    }
  }
  return {
    kind: 'graded',
    key: planned.key,
    slotMap: planned.slotMap,
    dimensions: combine(seats, config.dimensions),
    seats,
    seatFailures,
    // Left slot-keyed on purpose. A flag says "X did this", and X is a
    // different arm in the next judgment, so turning it into an arm is
    // scoring's job with that judgment's own slot map.
    flags: seats.flatMap((s) => s.verdict.flags ?? []),
    absoluteFloor: combineFloor(seats),
  }
}

export const judgeAll = async (
  llm: JsonJudgeModel,
  cases: readonly NormalizedCase[],
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): Promise<Judgment[]> => {
  const judgments: Judgment[] = []
  for (const planned of planJudgments(cases, config)) {
    judgments.push(await judgeCase(llm, planned, config))
  }
  return judgments
}

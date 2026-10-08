import type { ContractNote } from './outputContract'
import { bootstrapCi, createRng, mean, type Interval } from './bootstrap'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig, type Rng } from './config'
import {
  OVERALL,
  type FlagType,
  type GradedJudgment,
  type Judgment,
  type Magnitude,
  type SlotVerdict,
} from './judge'
import type { NormalizedAgent, SlotMap } from './normalize'
import { errorClass, publicToolName } from './toolErrorDetails'
import { priceUsd, sharesPricing } from './pricing'
import {
  ArmSchema,
  type AgentShape,
  type Arm,
  type CiContext,
  type RunRecord,
} from './record'

// Un-blinds, orients everything to the candidate, and turns a pile of
// slot-level judgments into one verdict for one agent.
//
// Nothing here is ever blended across agents. Averaging a Chief of Staff
// score against a briefing score would be meaningless: they do different
// work on different inputs, so the answer would be a number with no
// referent. One agent, one verdict, plus a coverage line.

export const VERDICT_LABELS = ['BETTER', 'WORSE', 'SAME', "CAN'T SAY"] as const
export type VerdictLabel = (typeof VERDICT_LABELS)[number]

// The judge said a slot. This is the only place a slot becomes a direction,
// and it is why the slot map is stored on our side rather than sent.
export const orient = (
  verdict: SlotVerdict,
  slotMap: SlotMap,
): number | null => {
  if (verdict === 'tie') return 0
  // cannot_determine is not a zero. A zero is the judge saying the two runs
  // are equally good; this is the judge saying it could not tell, which is
  // excluded from the score and counted on its own.
  if (verdict === 'cannot_determine') return null
  return slotMap[verdict] === 'candidate' ? 1 : -1
}

export interface DimensionScore {
  // Net preference rate for the candidate, in [-1, +1]. Delta = 0.30 means
  // the candidate is preferred on net in about thirty percentage points
  // more cases. It is NOT "thirty percent better" — a pairwise comparison
  // does not yield a percentage improvement.
  delta: number | null
  interval: Interval | null
  // Distinct cases with at least one scored pair.
  cases: number
  // Raw judge calls. Never below the pair count, and above it by however
  // many pairs the order-swap subsample judged in both orders.
  judgments: number
  // Per reconciled pair, not per judgment, because the report prints these
  // in the same table row as `cases`.
  wins: number
  losses: number
  ties: number
  cannotDetermine: number
  // The same refusals counted per raw judgment. The ceiling gate is a
  // statement about how often the judge declines, so it needs a numerator
  // in the same unit as its `judgments` denominator.
  cannotDetermineJudgments: number
  magnitudes: Readonly<Record<Magnitude, number>>
}

export interface ArmMeasurement {
  base: number
  candidate: number
  delta: number
}

// Sits beside the verdict and never gates it. Only a comparison is claimed;
// these are measurements, reported so a reader can see what the branch cost
// as well as whether it was better.
export interface MeasuredEvidence {
  // Null when a model has no rates on record. Costing it at zero would make
  // the evidence fiction, and throwing would let a display problem take
  // down a verdict that measured evidence is never allowed to gate.
  costUsd: ArmMeasurement | null
  unpriceableReason: string | null
  latencyMs: ArmMeasurement
  toolErrors: ArmMeasurement
  // Cases the measurement covers: pairs where both arms produced a result.
  pairs: number
  // True when the two arms were priced under different tables. Cost is
  // re-derived either way, so this does not invalidate the delta — but it
  // means one arm predates a price change, which is also a hint that a
  // cached base arm is stale.
  pricingMismatch: boolean
  // Cases that saw the live world through native web search, which is the
  // one input a sweep cannot hold still.
  liveWebCases: number
}

export interface ExclusionCounts {
  toolError: number
  infraError: number
  // Pairs whose two arms hashed to the same config. Nothing failed; there
  // was simply nothing to compare on that case.
  identicalConfig: number
  unpaired: number
  // A judge failure. Reported apart from CAN'T SAY, which is a real
  // verdict about a real comparison.
  ungraded: number
  // WHY THE JUDGE FAILED, deduplicated, because a count alone is not
  // actionable. The first live sweep reported "29 ungraded judgment(s)" and
  // nothing else; every seat had thrown the same sentence, and finding out
  // which one meant reproducing the run. The reasons are already on the
  // judgments — this carries them to the report.
  ungradedReasons: readonly string[]
  // The same treatment for tool-error exclusions, which had only a count.
  // Grouped so nine pairs failing one way read as one line, not nine.
  // Covers the pairs excluded for a tool error (chat only) and the pairs
  // excluded as identicalConfig whose arms hit tool errors anyway: before
  // background tool errors were scored, those were tool-error exclusions and
  // listed here, and moving them to another reason must not hide what failed.
  // A judged background pair's causes are in `scoredToolErrorCauses`.
  toolErrorCauses: readonly ToolErrorCause[]
}

export interface ToolErrorCause {
  // Allowlisted by publicToolName, so safe to print.
  tool: string
  // A fixed class from errorClass, never the error text: the report is
  // public and the text can carry voter data.
  errorClass: string
  // Pairs this cause appeared in, whichever arm it hit: excluded pairs in
  // `exclusions.toolErrorCauses`, judged pairs in `scoredToolErrorCauses`.
  pairs: number
  arms: readonly Arm[]
}

export interface OrientedFlag {
  arm: Arm
  type: FlagType
  explanation: string
  loc: string | undefined
  caseId: string
}

export interface FloorFailure {
  arm: Arm
  caseId: string
}

// A panel that lost a seat still produced a comparison, but it produced it
// on fewer opinions than the config asked for, and the verdict above reads
// identically either way.
//
// Null, not a zeroed record, when every judgment ran on the whole panel:
// the report has to be able to print nothing at all, because a reassuring
// "0 seats failed" line is a line readers learn to skip.
export interface DegradedPanel {
  // Judgments that ran a seat short, counted once each rather than once per
  // lost seat, because that is the number of verdicts the reduction touched.
  judgments: number
  // Distinct seats that failed at least once, sorted. Which seat is the
  // actionable half: one rate-limited family is a retry, a seat that fails
  // on every judgment is a broken config.
  seats: readonly string[]
}

// One of a case's own dimensions, scored over only the cases that carry it.
export interface CaseDimensionScore {
  name: string
  caseIds: readonly string[]
  score: DimensionScore
}

export interface AgentScore {
  agentId: string
  shape: AgentShape
  label: VerdictLabel
  // Why that label, in one sentence, including the "real but below the
  // practical margin" case that would otherwise look like noise.
  labelNote: string
  overall: DimensionScore
  dimensions: Readonly<Record<string, DimensionScore>>
  // Never folded into `dimensions`, `overall`, `regressions` or the label: a
  // question one probe asks is not evidence about the agent at large, and
  // averaging it in would let one case move every agent-level number.
  caseDimensions?: readonly CaseDimensionScore[]
  // Dimensions whose upper bound is below zero. Attached to every verdict
  // and never changes the label.
  regressions: readonly string[]
  exclusions: ExclusionCounts
  // Tool errors on pairs that were JUDGED anyway, grouped like
  // `exclusions.toolErrorCauses`. Only a background agent has any: its
  // verdict is on the final artifact, so a run that hit a failing Bash
  // snippet and recovered is scored rather than excluded (see isComparable),
  // and this keeps the evidence of what failed beside the verdict.
  scoredToolErrorCauses: readonly ToolErrorCause[]
  positionConsistency: number | null
  // THE DENOMINATOR, reported with the rate and never without it. 3 of 5 and
  // 60 of 100 are both "60%", and only one of them says anything.
  swappedPairs: number
  orderUnstablePairs: readonly string[]
  panelDisagreementRate: number | null
  flags: readonly OrientedFlag[]
  floorFailures: readonly FloorFailure[]
  // The judge could not tell whether the floor was met. Reported separately
  // from floorFailures rather than counted as one, and like a failure it never
  // changes the label.
  floorUnclear: readonly FloorFailure[]
  // Null when every judgment behind this verdict ran on the full panel.
  degradedPanel: DegradedPanel | null
  evidence: MeasuredEvidence
  ci: CiContext | null
  // Pairs on a case marked `scored: false`, one entry per pair, and in none
  // of the numbers above. Empty for an agent with no such case.
  controls: readonly ControlReading[]
  // Cases the candidate's list marks `scored: false` that were scored anyway,
  // because the base ref's list does not hold them out or could not be read.
  controlsScoredAnyway?: ControlsScoredAnyway
  // Set when a background agent was judged without its output contract,
  // because the manifest requires no top-level field or could not be read.
  outputContractNote?: ContractNote
}

export interface ControlsScoredAnyway {
  caseIds: readonly string[]
  why: 'baseDisagrees' | 'baseUnread'
}

// What the judge said about one control pair, oriented to the candidate like
// everything else here. On a control a call other than a tie is the judge's
// own noise floor on this input, which is the number a reader needs before
// trusting any other verdict in the section.
export type ControlOutcome =
  | 'candidate'
  | 'base'
  | 'tie'
  | 'cannot_determine'
  // Judged, but every seat failed.
  | 'ungraded'
  // Never reached the judge: excluded or missing an arm.
  | 'not_judged'

export interface ControlReading {
  caseId: string
  attempt: number
  outcome: ControlOutcome
  magnitude: Magnitude | null
  // The same pair with X and Y swapped. Every control is judged both ways, so
  // this is absent only for a pair that never reached the judge.
  swapped?: { outcome: ControlOutcome; magnitude: Magnitude | null }
}

// What the two orders together say about a control, oriented to the arms:
// the same call both ways followed the outputs; opposite calls mean the judge
// picked the same SLOT both times, which is a position preference.
export type ControlPosition = 'sameCall' | 'sameSlot' | 'changed' | 'unread'

export const controlPosition = (reading: ControlReading): ControlPosition => {
  const swapped = reading.swapped?.outcome
  const called = (one: ControlOutcome | undefined): boolean =>
    one === 'candidate' || one === 'base' || one === 'tie'
  if (!called(reading.outcome) || !called(swapped)) return 'unread'
  if (reading.outcome === swapped) return 'sameCall'
  if (reading.outcome !== 'tie' && swapped !== 'tie') return 'sameSlot'
  return 'changed'
}

interface PairScore {
  caseId: string
  attempt: number
  score: number | null
  // Undefined when the pair was not in the order-swap subsample, so it
  // contributes nothing to the consistency rate either way.
  consistent: boolean | undefined
  // Only an outright conflict, where the two orders named opposite winners.
  // A tie against a win disagrees without being unstable.
  unstable: boolean
}

const emptyMagnitudes = (): Record<Magnitude, number> => ({
  slight: 0,
  clear: 0,
  strong: 0,
})

const graded = (judgments: readonly Judgment[]): GradedJudgment[] =>
  judgments.filter((j): j is GradedJudgment => j.kind === 'graded')

const pairKey = (caseId: string, attempt: number): string =>
  `${caseId}#${attempt}`

// The reconciliation rule from the rubric doc. Both scores are already
// oriented to the candidate, so they are directly comparable even though
// the judge saw the slots the other way round the second time.
type Reconciled = Pick<PairScore, 'score' | 'consistent' | 'unstable'>

const reconcile = (
  primary: number | null,
  swapped: number | null | undefined,
): Reconciled => {
  if (swapped === undefined) {
    return { score: primary, consistent: undefined, unstable: false }
  }
  // One order could not be decided, so there is no second verdict to agree
  // with. The pair keeps whichever verdict exists and leaves the
  // consistency denominator alone rather than counting as a disagreement.
  if (primary === null || swapped === null) {
    return {
      score: primary ?? swapped,
      consistent: undefined,
      unstable: false,
    }
  }
  if (primary === swapped) {
    return { score: primary, consistent: true, unstable: false }
  }
  // A tie against a win is a partial agreement: half the win, and it does
  // not count as the orders agreeing.
  if (primary === 0 || swapped === 0) {
    return {
      score: (primary + swapped) / 2,
      consistent: false,
      unstable: false,
    }
  }
  // Opposite wins. The judge read position, not quality, so the pair
  // contributes nothing and is named as order-unstable.
  return { score: 0, consistent: false, unstable: true }
}

// Each dimension gets its own stream, derived from the seed and the
// dimension's name, so adding a dimension to the config cannot shift
// another dimension's interval. A single shared stream would make every
// number order-dependent, which is a nasty thing to debug in a report.
const streamFor = (seed: number, dimension: string): Rng => {
  let offset = 0
  for (const char of dimension) {
    offset = (offset * 31 + char.charCodeAt(0)) >>> 0
  }
  return createRng((seed + offset) >>> 0)
}

const scoreDimension = (
  judgments: readonly GradedJudgment[],
  dimension: string,
  config: JudgeConfig,
  seed: number,
): { score: DimensionScore; pairs: PairScore[] } => {
  const magnitudes = emptyMagnitudes()
  let judgmentCount = 0
  let cannotDetermineJudgments = 0

  const primary = new Map<string, number | null>()
  const swapped = new Map<string, number | null>()
  const identities = new Map<string, { caseId: string; attempt: number }>()
  // Held per pair rather than counted per judgment, for the same reason
  // orientFlags, floorVerdicts and the W/T/L tally below dedupe: the
  // order-swap subsample judges the same pair twice, so a per-judgment
  // count inflates the distribution on exactly the 20% of pairs that got
  // the second look — and the report prints that total two lines below the
  // case count it is meant to describe.
  const magnitudeOfPair = new Map<string, Magnitude>()

  for (const judgment of judgments) {
    const combined = judgment.dimensions[dimension]
    if (combined === undefined) continue
    const value = orient(combined.verdict, judgment.slotMap)
    judgmentCount += 1
    if (value === null) cannotDetermineJudgments += 1

    const key = pairKey(judgment.key.caseId, judgment.key.attempt)
    if (combined.magnitude !== null && !magnitudeOfPair.has(key)) {
      magnitudeOfPair.set(key, combined.magnitude)
    }
    identities.set(key, {
      caseId: judgment.key.caseId,
      attempt: judgment.key.attempt,
    })
    if (judgment.key.order === 'swapped') swapped.set(key, value)
    else primary.set(key, value)
  }

  for (const magnitude of magnitudeOfPair.values()) {
    magnitudes[magnitude] += 1
  }

  const pairs: PairScore[] = []
  for (const [key, identity] of identities) {
    const hasSwap = swapped.has(key)
    const resolved = reconcile(
      primary.has(key) ? (primary.get(key) ?? null) : null,
      hasSwap ? (swapped.get(key) ?? null) : undefined,
    )
    pairs.push({ ...identity, ...resolved })
  }

  // Off the reconciled pairs, because the report prints this beside the
  // case count. A per-judgment tally reads ~20% high against that count,
  // and it also reports a pair whose two orders split as both a win and a
  // tie instead of the one half-win the delta was actually scored from.
  let wins = 0
  let losses = 0
  let ties = 0
  let cannotDetermine = 0
  for (const pair of pairs) {
    if (pair.score === null) cannotDetermine += 1
    else if (pair.score > 0) wins += 1
    else if (pair.score < 0) losses += 1
    else ties += 1
  }

  // Each case carries equal weight regardless of how many attempts produced
  // a verdict, so one noisy case cannot dominate the corpus.
  const byCase = new Map<string, number[]>()
  for (const pair of pairs) {
    if (pair.score === null) continue
    byCase.set(pair.caseId, [...(byCase.get(pair.caseId) ?? []), pair.score])
  }
  const caseScores = [...byCase.values()].map(mean)

  return {
    score: {
      delta: caseScores.length === 0 ? null : mean(caseScores),
      interval: bootstrapCi(
        caseScores,
        config.bootstrap,
        streamFor(seed, dimension),
      ),
      cases: caseScores.length,
      judgments: judgmentCount,
      wins,
      losses,
      ties,
      cannotDetermine,
      cannotDetermineJudgments,
      magnitudes,
    },
    pairs,
  }
}

// Cost is ALWAYS re-derived and never read from cost.usdAtCapture. A cached
// base arm can predate its candidate by months, so comparing two stored
// dollar figures measures the price list as much as the branch.
const measure = (
  pairs: readonly { base: RunRecord; candidate: RunRecord }[],
): MeasuredEvidence => {
  const usable = pairs.filter(
    (p) =>
      p.base.status !== 'infraError' && p.candidate.status !== 'infraError',
  )
  const armMean = (pick: (record: RunRecord) => number): ArmMeasurement => {
    const base = mean(usable.map((p) => pick(p.base)))
    const candidate = mean(usable.map((p) => pick(p.candidate)))
    return { base, candidate, delta: candidate - base }
  }
  let costUsd: ArmMeasurement | null = null
  let unpriceableReason: string | null = null
  try {
    costUsd = armMean((r) => priceUsd(r.telemetry.tokens, r.variant.model))
  } catch (err) {
    unpriceableReason = err instanceof Error ? err.message : String(err)
  }
  return {
    costUsd,
    unpriceableReason,
    latencyMs: armMean((r) => r.telemetry.latencyMs),
    toolErrors: armMean((r) => r.telemetry.toolErrors),
    pairs: usable.length,
    // Over `usable`, like every other figure here. A pair whose arm died in
    // infra was never measured, so letting it set this flag would report a
    // mismatch about a comparison that was not made.
    //
    // The optional reads are deliberate and currently inert: `record.ts`
    // declares `cost` required on this branch, so neither can short-circuit
    // today. They are here for the optional `cost` that arrives with the
    // chat runner, so that merge lands on an already-guarded read rather
    // than on a break that shows up only once both changes are in. An
    // absent cost is also not a pricing MISMATCH — there is no second
    // version for it to disagree with — and it already surfaces as
    // `unpriceableReason`.
    pricingMismatch: usable.some((p) => {
      const base = p.base.telemetry.cost?.pricingVersion
      const candidate = p.candidate.telemetry.cost?.pricingVersion
      return (
        base !== undefined &&
        candidate !== undefined &&
        !sharesPricing(base, candidate)
      )
    }),
    // Cases, not attempt-pairs: with three attempts per case a pair count
    // would report three times the number of cases the rest of the score is
    // computed over.
    liveWebCases: new Set(
      pairs
        .filter((p) => p.base.liveWeb || p.candidate.liveWeb)
        .map((p) => p.base.caseId),
    ).size,
  }
}

interface Gate {
  failed: boolean
  note: string
}

const gates = (
  overall: DimensionScore,
  positionConsistency: number | null,
  swappedPairs: number,
  panelDisagreementRate: number | null,
  config: JudgeConfig,
): Gate => {
  const g = config.gates
  if (overall.cases < g.minCases) {
    return {
      failed: true,
      note:
        `${overall.cases} cases is below the floor of ${g.minCases}, so ` +
        'the comparison measures the agents own variance more than the ' +
        'branch',
    }
  }
  // Both ends in judgments. `cannotDetermine` is per pair, so using it
  // here would divide pairs by judgments and read the ceiling ~20% low.
  const cdRate =
    overall.judgments === 0
      ? 0
      : overall.cannotDetermineJudgments / overall.judgments
  if (cdRate > g.cannotDetermineCeiling) {
    return {
      failed: true,
      note:
        `the judge could not tell on ${(cdRate * 100).toFixed(0)}% of ` +
        `judgments, above the ${(g.cannotDetermineCeiling * 100).toFixed(0)}` +
        '% ceiling',
    }
  }
  // The sample size is checked before the rate, because a rate computed over
  // five pairs is not evidence that the judge reads position — it is five
  // pairs. The report still prints it, with its denominator.
  if (
    positionConsistency !== null &&
    swappedPairs >= g.minSwappedPairs &&
    positionConsistency < g.consistencyFloor
  ) {
    return {
      failed: true,
      note:
        `order-swapped pairs agreed only ${(positionConsistency * 100).toFixed(
          0,
        )}% of the time, below the ` +
        `${(g.consistencyFloor * 100).toFixed(0)}% floor: the judge is ` +
        'reading position rather than quality',
    }
  }
  if (
    panelDisagreementRate !== null &&
    panelDisagreementRate > g.panelDisagreementCeiling
  ) {
    return {
      failed: true,
      note: `judge seats disagreed on direction in ${(
        panelDisagreementRate * 100
      ).toFixed(0)}% of judgments`,
    }
  }
  return { failed: false, note: '' }
}

const label = (
  overall: DimensionScore,
  gate: Gate,
  config: JudgeConfig,
): { label: VerdictLabel; note: string } => {
  if (gate.failed) return { label: "CAN'T SAY", note: gate.note }
  const { delta, interval } = overall
  if (delta === null || interval === null) {
    return { label: "CAN'T SAY", note: 'no judgments to score' }
  }
  const margin = config.gates.practicalMargin
  if (interval.lower > 0 && delta >= margin) {
    return { label: 'BETTER', note: 'the whole interval is above zero' }
  }
  if (interval.upper < 0 && delta <= -margin) {
    return { label: 'WORSE', note: 'the whole interval is below zero' }
  }
  // Checked BEFORE the SAME rule, and the order is load-bearing. An
  // interval that excludes zero but sits inside the margin, such as
  // [0.01, 0.09] against a margin of 0.1, satisfies the SAME condition as
  // written in the rubric doc while being a real, measured effect. Calling
  // that equivalence would be wrong: it is a difference too small to act
  // on, which is a different statement.
  if (interval.lower > 0 || interval.upper < 0) {
    return {
      label: "CAN'T SAY",
      note: 'real but below the practical margin',
    }
  }
  // An affirmative finding of equivalence, which is a stronger claim than
  // "not significant": the entire interval has to sit inside the margin.
  if (interval.lower >= -margin && interval.upper <= margin) {
    return {
      label: 'SAME',
      note: `the whole interval sits inside the +/-${margin} margin`,
    }
  }
  return {
    label: "CAN'T SAY",
    note: 'the interval straddles zero, so the comparison did not resolve',
  }
}

// Deduped by arm, type and case: the order-swap subsample judges the same
// pair twice, and a flag counted once per order would inflate on exactly
// the 20% of cases that got the extra look.
const orientFlags = (judgments: readonly GradedJudgment[]): OrientedFlag[] => {
  const seen = new Map<string, OrientedFlag>()
  for (const j of judgments) {
    for (const flag of j.flags) {
      // A flag says "X did this", and X is a different arm in the next
      // judgment. Orienting it with THIS judgment's slot map is the only
      // way the count means anything.
      const arm = j.slotMap[flag.run]
      const oriented: OrientedFlag = {
        arm,
        type: flag.type,
        explanation: flag.explanation,
        loc: flag.loc,
        caseId: j.key.caseId,
      }
      const key = `${arm}\u0000${flag.type}\u0000${j.key.caseId}`
      if (!seen.has(key)) seen.set(key, oriented)
    }
  }
  return [...seen.values()]
}

// Deduped by arm and case for the same reason orientFlags is: the
// order-swap subsample judges the same pair twice, so a floor kept per
// judgment reports one broken run as two on exactly the pairs that got the
// second look.
// `unclear` is reported, but NOT as a failure. `combineFloor` produces it when
// no seat said `no` and at least one was uncertain, so folding it into the
// failure count would put "a reasonable user would not accept this" and "the
// judge could not tell" behind one number — the blend this whole layer refuses
// everywhere else. Dropping it was worse: an uncertain floor reached here and
// contributed nothing, so the report never fired on it at all.
//
// `no` wins over `unclear` for the same arm and case, because one seat naming
// a run unacceptable is not softened by another being unsure.
const floorVerdicts = (
  judgments: readonly GradedJudgment[],
): { failed: FloorFailure[]; unclear: FloorFailure[] } => {
  const worst = new Map<string, { entry: FloorFailure; failed: boolean }>()
  const add = (arm: Arm, caseId: string, failed: boolean): void => {
    const key = `${arm}\u0000${caseId}`
    const held = worst.get(key)
    if (held === undefined) worst.set(key, { entry: { arm, caseId }, failed })
    else if (failed) held.failed = true
  }
  for (const j of judgments) {
    const floor = j.absoluteFloor
    if (floor === null) continue
    for (const [slot, acceptable] of [
      [j.slotMap.X, floor.X_acceptable],
      [j.slotMap.Y, floor.Y_acceptable],
    ] as const) {
      if (acceptable === 'no') add(slot, j.key.caseId, true)
      else if (acceptable === 'unclear') add(slot, j.key.caseId, false)
    }
  }
  const held = [...worst.values()]
  return {
    failed: held.filter((h) => h.failed).map((h) => h.entry),
    unclear: held.filter((h) => !h.failed).map((h) => h.entry),
  }
}

// A record written before toolErrorDetails existed has the count and no
// detail. It still gets a line, so the causes always account for every
// tool-error exclusion.
const UNRECORDED = 'unrecorded'

const armsWithToolErrors = (records: {
  base: RunRecord
  candidate: RunRecord
}): Arm[] =>
  ArmSchema.options.filter((arm) => records[arm].telemetry.toolErrors > 0)

// SCORED means a graded judgment exists for the pair. A pair whose every
// judge call failed is ungraded and counted apart, so listing it here would
// say it was scored when it was not. Empty for a chat agent, whose tool-error
// pairs never reach `judgeable`.
const scoredWithToolErrors = (
  normalized: NormalizedAgent,
  gradedJudgments: readonly GradedJudgment[],
): ToolErrorPair[] => {
  const gradedPairs = new Set(
    gradedJudgments.map((j) => pairKey(j.key.caseId, j.key.attempt)),
  )
  return normalized.judgeable.flatMap(({ caseId, attempt, records }) => {
    if (!gradedPairs.has(pairKey(caseId, attempt))) return []
    const arms = armsWithToolErrors(records)
    return arms.length > 0 ? [{ arms, records }] : []
  })
}

// Excluded pairs whose tool errors the report should name: every tool-error
// exclusion, and an identicalConfig exclusion whose arms hit tool errors. The
// second is a background pair; it was a tool-error exclusion before tool
// errors stopped excluding background pairs, and its causes must not vanish.
// An infraError pair is left out, as it always was: a run that died never got
// far enough for a tool error to mean anything about it.
const excludedWithToolErrors = (normalized: NormalizedAgent): ToolErrorPair[] =>
  normalized.excluded.flatMap(({ reason, arms, records }) => {
    if (reason === 'toolError') return [{ arms, records }]
    if (reason !== 'identicalConfig') return []
    const hit = armsWithToolErrors(records)
    return hit.length > 0 ? [{ arms: hit, records }] : []
  })

interface ToolErrorPair {
  arms: readonly Arm[]
  records: { base: RunRecord; candidate: RunRecord }
}

// Built from errorClass and publicToolName only, never from the message:
// this is what reaches the public report. See toolErrorDetails.ts.

const toolErrorCauses = (pairs: readonly ToolErrorPair[]): ToolErrorCause[] => {
  const causes = new Map<
    string,
    { tool: string; errorClass: string; pairs: number; arms: Set<Arm> }
  >()
  for (const pair of pairs) {
    const seen = new Set<string>()
    for (const arm of pair.arms) {
      const details = pair.records[arm].toolErrorDetails ?? []
      const found =
        details.length > 0
          ? details.map((detail) => ({
              tool: publicToolName(detail.tool, pair.records[arm].agentShape),
              errorClass: errorClass(detail.message),
            }))
          : [{ tool: 'unknown', errorClass: UNRECORDED }]
      for (const { tool, errorClass: cls } of found) {
        const key = `${tool}\u0000${cls}`
        const cause = causes.get(key) ?? {
          tool,
          errorClass: cls,
          pairs: 0,
          arms: new Set<Arm>(),
        }
        if (!seen.has(key)) cause.pairs += 1
        seen.add(key)
        cause.arms.add(arm)
        causes.set(key, cause)
      }
    }
  }
  return [...causes.values()]
    .map((cause) => ({
      ...cause,
      arms: ArmSchema.options.filter((arm) => cause.arms.has(arm)),
    }))
    .sort(
      (a, b) =>
        b.pairs - a.pairs ||
        a.tool.localeCompare(b.tool) ||
        a.errorClass.localeCompare(b.errorClass),
    )
}

// Graded judgments only. A judgment whose every seat failed came back
// `ungraded`, which is already counted in `exclusions.ungraded` and named in
// the report; counting it here as well would report one failure twice and
// bury the case this exists for — a panel that lost SOME seats and returned
// a verdict anyway.
const degradedPanel = (
  judgments: readonly GradedJudgment[],
): DegradedPanel | null => {
  const seats = new Set<string>()
  let affected = 0
  for (const judgment of judgments) {
    if (judgment.seatFailures.length === 0) continue
    affected += 1
    for (const failure of judgment.seatFailures) seats.add(failure.model)
  }
  return affected === 0
    ? null
    : { judgments: affected, seats: [...seats].sort() }
}

// Off the payloads the judge was sent, so a row exists only for a question
// the panel was actually asked, and its case list is the cases that asked it.
const scoreCaseDimensions = (
  normalized: NormalizedAgent,
  judgments: readonly GradedJudgment[],
  config: JudgeConfig,
  seed: number,
): CaseDimensionScore[] => {
  const carriers = new Map<string, Set<string>>()
  for (const c of normalized.judgeable) {
    for (const d of c.payload.caseDimensions ?? []) {
      carriers.set(d.name, (carriers.get(d.name) ?? new Set()).add(c.caseId))
    }
  }
  return [...carriers]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, caseIds]) => ({
      name,
      caseIds: [...caseIds].sort(),
      score: scoreDimension(judgments, name, config, seed).score,
    }))
}

export interface ScoreInput {
  normalized: NormalizedAgent
  judgments: readonly Judgment[]
  // Cases marked `scored: false`. Held out of EVERY aggregate — the verdict,
  // the dimensions, the gates, the floor, the flags, the exclusion counts and
  // the measured evidence — and reported as `controls` instead.
  unscoredCaseIds?: ReadonlySet<string>
}

const orientedOutcome = (
  oriented: number | null,
): ControlReading['outcome'] => {
  if (oriented === null) return 'cannot_determine'
  if (oriented === 0) return 'tie'
  return oriented > 0 ? 'candidate' : 'base'
}

// The primary-order judgment is the reading, and the swapped one sits beside
// it: every control is judged both ways (see planJudgments), and the pair of
// them is what shows a position preference.
const controlReadings = (
  normalized: NormalizedAgent,
  judgments: readonly Judgment[],
  unscored: ReadonlySet<string>,
): ControlReading[] => {
  const readings: ControlReading[] = []
  for (const one of normalized.judgeable) {
    if (!unscored.has(one.caseId)) continue
    const read = (
      order: 'primary' | 'swapped',
    ): { outcome: ControlOutcome; magnitude: Magnitude | null } | undefined => {
      const judgment = judgments.find(
        (j) =>
          j.key.caseId === one.caseId &&
          j.key.attempt === one.attempt &&
          j.key.order === order,
      )
      if (judgment === undefined) return undefined
      const overall =
        judgment.kind === 'graded' ? judgment.dimensions[OVERALL] : undefined
      if (judgment.kind !== 'graded' || overall === undefined) {
        return { outcome: 'ungraded', magnitude: null }
      }
      return {
        outcome: orientedOutcome(orient(overall.verdict, judgment.slotMap)),
        magnitude: overall.magnitude ?? null,
      }
    }
    const primary = read('primary') ?? {
      outcome: 'not_judged' as const,
      magnitude: null,
    }
    const swapped = read('swapped')
    readings.push({
      caseId: one.caseId,
      attempt: one.attempt,
      ...primary,
      ...(swapped !== undefined && { swapped }),
    })
  }
  for (const one of [...normalized.excluded, ...normalized.unpaired]) {
    if (!unscored.has(one.caseId)) continue
    readings.push({
      caseId: one.caseId,
      attempt: one.attempt,
      outcome: 'not_judged',
      magnitude: null,
    })
  }
  return readings.sort(
    (a, b) => a.caseId.localeCompare(b.caseId) || a.attempt - b.attempt,
  )
}

export const scoreAgent = (
  { normalized: all, judgments: allJudgments, unscoredCaseIds }: ScoreInput,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
  // Seeded by default so two runs over the same judgments report the same
  // interval; a caller that wants a different draw passes another seed.
  seed = 1,
): AgentScore => {
  const unscored = unscoredCaseIds ?? new Set<string>()
  const scoredCase = (one: { caseId: string }): boolean =>
    !unscored.has(one.caseId)
  const normalized: NormalizedAgent = {
    ...all,
    judgeable: all.judgeable.filter(scoredCase),
    excluded: all.excluded.filter(scoredCase),
    unpaired: all.unpaired.filter(scoredCase),
  }
  const judgments = allJudgments.filter((j) => scoredCase(j.key))
  const gradedJudgments = graded(judgments)
  const dimensions: Record<string, DimensionScore> = {}
  for (const dimension of config.dimensions) {
    dimensions[dimension] = scoreDimension(
      gradedJudgments,
      dimension,
      config,
      seed,
    ).score
  }
  const overallResult = scoreDimension(gradedJudgments, OVERALL, config, seed)
  const caseDimensions = scoreCaseDimensions(
    normalized,
    gradedJudgments,
    config,
    seed,
  )
  const overall = overallResult.score

  const swappedPairs = overallResult.pairs.filter(
    (p) => p.consistent !== undefined,
  )
  const positionConsistency =
    swappedPairs.length === 0
      ? null
      : swappedPairs.filter((p) => p.consistent === true).length /
        swappedPairs.length

  const overallJudgments = gradedJudgments.filter(
    (j) => j.dimensions[OVERALL] !== undefined,
  )
  const panelDisagreementRate =
    config.panel.seats.length < 2 || overallJudgments.length === 0
      ? null
      : overallJudgments.filter(
          (j) => j.dimensions[OVERALL]?.directionConflict === true,
        ).length / overallJudgments.length

  const gate = gates(
    overall,
    positionConsistency,
    swappedPairs.length,
    panelDisagreementRate,
    config,
  )
  const labelled = label(overall, gate, config)

  const floor = floorVerdicts(gradedJudgments)

  const allPairs = [
    ...normalized.judgeable.map((c) => c.records),
    ...normalized.excluded.map((c) => c.records),
  ]
  // Over every pair, controls included: the CI context says which change was
  // under test, and an agent whose only pairs were controls still tested one.
  const candidateWithCi = [
    ...all.judgeable.map((c) => c.records),
    ...all.excluded.map((c) => c.records),
  ].find((p) => p.candidate.ci !== undefined)

  return {
    agentId: normalized.agentId,
    shape: normalized.shape,
    label: labelled.label,
    labelNote: labelled.note,
    overall,
    dimensions,
    ...(caseDimensions.length > 0 && { caseDimensions }),
    regressions: Object.entries(dimensions)
      .filter(([, score]) => (score.interval?.upper ?? 0) < 0)
      .map(([name]) => name),
    exclusions: {
      toolError: normalized.excluded.filter((e) => e.reason === 'toolError')
        .length,
      infraError: normalized.excluded.filter((e) => e.reason === 'infraError')
        .length,
      identicalConfig: normalized.excluded.filter(
        (e) => e.reason === 'identicalConfig',
      ).length,
      unpaired: normalized.unpaired.length,
      ungraded: judgments.filter((j) => j.kind === 'ungraded').length,
      ungradedReasons: [
        ...new Set(
          judgments.filter((j) => j.kind === 'ungraded').map((j) => j.reason),
        ),
      ],
      toolErrorCauses: toolErrorCauses(excludedWithToolErrors(normalized)),
    },
    scoredToolErrorCauses: toolErrorCauses(
      scoredWithToolErrors(normalized, gradedJudgments),
    ),
    positionConsistency,
    swappedPairs: swappedPairs.length,
    orderUnstablePairs: overallResult.pairs
      .filter((p) => p.unstable)
      .map((p) => pairKey(p.caseId, p.attempt)),
    panelDisagreementRate,
    flags: orientFlags(gradedJudgments),
    floorFailures: floor.failed,
    floorUnclear: floor.unclear,
    degradedPanel: degradedPanel(gradedJudgments),
    evidence: measure(allPairs),
    ci: candidateWithCi?.candidate.ci ?? null,
    controls: controlReadings(all, allJudgments, unscored),
  }
}

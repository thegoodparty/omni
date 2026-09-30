import { bootstrapCi, createRng, mean, type Interval } from './bootstrap'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig, type Rng } from './config'
import {
  OVERALL,
  type GradedJudgment,
  type Judgment,
  type Magnitude,
  type SlotVerdict,
} from './judge'
import type { NormalizedAgent, SlotMap } from './normalize'
import { priceUsd, sharesPricing } from './pricing'
import type { AgentShape, Arm, CiContext, RunRecord } from './record'

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
}

export interface OrientedFlag {
  arm: Arm
  type: string
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

export interface AgentScore {
  agentId: string
  shape: AgentShape
  label: VerdictLabel
  // Why that label, in one sentence, including the "real but below the
  // practical margin" case that would otherwise look like noise.
  labelNote: string
  overall: DimensionScore
  dimensions: Readonly<Record<string, DimensionScore>>
  // Dimensions whose upper bound is below zero. Attached to every verdict
  // and never changes the label.
  regressions: readonly string[]
  exclusions: ExclusionCounts
  positionConsistency: number | null
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
  if (
    positionConsistency !== null &&
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

export interface ScoreInput {
  normalized: NormalizedAgent
  judgments: readonly Judgment[]
}

export const scoreAgent = (
  { normalized, judgments }: ScoreInput,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
  // Seeded by default so two runs over the same judgments report the same
  // interval; a caller that wants a different draw passes another seed.
  seed = 1,
): AgentScore => {
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
    panelDisagreementRate,
    config,
  )
  const labelled = label(overall, gate, config)

  const floor = floorVerdicts(gradedJudgments)

  const allPairs = [
    ...normalized.judgeable.map((c) => c.records),
    ...normalized.excluded.map((c) => c.records),
  ]
  const candidateWithCi = allPairs.find((p) => p.candidate.ci !== undefined)

  return {
    agentId: normalized.agentId,
    shape: normalized.shape,
    label: labelled.label,
    labelNote: labelled.note,
    overall,
    dimensions,
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
    },
    positionConsistency,
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
  }
}

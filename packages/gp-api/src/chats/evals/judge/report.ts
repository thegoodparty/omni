import { AGENTS, coverage, type AgentEntry } from './agents'
import type { Interval } from './bootstrap'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { PRICING_VERSION } from './pricing'
import type { AgentScore, DimensionScore } from './score'
import type { CiContext } from './record'

// The PR comment.
//
// Three things in here came out of design review and are not decoration.
// The link back to the change, because a verdict you cannot trace to a
// commit and a PR is much less useful. The coverage line, because it is the
// anti-stall mechanic and has to print whether or not anything was judged.
// And the separation of judged from measured: cost, latency and tool-error
// deltas sit BESIDE the verdict as evidence and never gate it, because only
// a comparison is being claimed.

export interface Refusal {
  agentId: string
  reason: string
}

export interface SweepReport {
  // One entry per agent. Never a blended number: a Chief of Staff score
  // averaged against a briefing score would have no referent.
  agents: readonly AgentScore[]
  // Comparisons the judge declined to make at all, such as two arms that
  // hashed to the same config.
  refusals?: readonly Refusal[]
  // Taken explicitly so the coverage line always describes the same
  // registry the selection came from.
  registry?: readonly AgentEntry[]
}

const signed = (value: number, digits: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`

const formatInterval = (interval: Interval | null): string =>
  interval === null
    ? 'no interval'
    : `[${interval.lower.toFixed(2)}, ${interval.upper.toFixed(2)}]`

const formatDelta = (score: DimensionScore): string =>
  score.delta === null
    ? 'no delta'
    : `${signed(score.delta, 2)} ${formatInterval(score.interval)}`

const percentOf = (value: number | null): string =>
  value === null ? 'n/a' : `${(value * 100).toFixed(0)}%`

const dimensionRow = (name: string, score: DimensionScore): string =>
  `| ${name} | ${formatDelta(score)} | ${score.cases} | ` +
  `${score.wins}/${score.ties}/${score.losses} | ${score.cannotDetermine} |`

// Reported as a distribution and never folded into the score: magnitude
// calibration across judge families does not exist yet, so weighting by it
// would add an unvalidated assumption to the primary statistic.
const magnitudeLine = (score: DimensionScore): string | null => {
  const parts = Object.entries(score.magnitudes)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${count} ${name}`)
  return parts.length === 0
    ? null
    : `Overall magnitudes (per pair): ${parts.join(', ')}.`
}

// By arm and type, which is the count the rubric doc asks for. Orientation
// happened in scoring; a raw slot count would be meaningless.
const flagLine = (score: AgentScore): string | null => {
  if (score.flags.length === 0) return null
  const counts = new Map<string, number>()
  for (const flag of score.flags) {
    const key = `${flag.arm} ${flag.type}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return `Flags (cases affected): ${[...counts.entries()]
    .map(([key, count]) => `${count} on ${key}`)
    .join(', ')}.`
}

const changeLine = (ci: CiContext | null): string =>
  ci === null
    ? '_No CI context on these records, so this verdict cannot be traced ' +
      'back to a pull request. That means it came from a local run._'
    : `Change under test: ${ci.repo}` +
      (ci.prNumber === undefined ? '' : ` #${ci.prNumber}`) +
      ` — [workflow run ${ci.workflowRunId}](${ci.workflowRunUrl})` +
      (ci.workflowRunAttempt > 1 ? ` (attempt ${ci.workflowRunAttempt})` : '')

const evidenceLines = (score: AgentScore): string[] => {
  const { evidence } = score
  if (evidence.pairs === 0) {
    return [
      'Measured: nothing to measure \u2014 no pair had a result on ' +
        'both arms.',
    ]
  }
  const cost = evidence.costUsd
  const lines = [
    'Measured, beside the verdict and never part of it ' +
      `(re-derived at pricing ${PRICING_VERSION}, not read from the ` +
      'records stored dollars):',
    '',
    cost === null
      ? `- cost: not derivable — ${evidence.unpriceableReason}`
      : `- cost: ${signed(cost.delta, 4)} USD per run pair ` +
        `(base ${cost.base.toFixed(4)}, candidate ` +
        `${cost.candidate.toFixed(4)})`,
    `- latency: ${signed(evidence.latencyMs.delta, 0)} ms per run pair`,
    `- tool errors: ${signed(evidence.toolErrors.delta, 2)} per run pair`,
    `- measured over ${evidence.pairs} run pair(s)`,
  ]
  if (evidence.liveWebCases > 0) {
    lines.push(
      `- ${evidence.liveWebCases} case(s) used native web search, so those ` +
        'saw the live world and could not be held still',
    )
  }
  if (evidence.pricingMismatch) {
    lines.push(
      '- **pricing version mismatch between the arms.** Cost is re-derived ' +
        'so the delta still holds, but one arm predates a price change, ' +
        'which usually means a cached base arm is stale',
    )
  }
  return lines
}

const exclusionLine = (score: AgentScore): string => {
  const e = score.exclusions
  return (
    `Excluded pairs: ${e.toolError} tool error, ${e.infraError} infra ` +
    `error, ${e.identicalConfig} identical config. Plus ${e.unpaired} ` +
    `unpaired record(s). Separately, ${e.ungraded} ungraded judgment(s) ` +
    "(the judge itself failed, which is not a CAN'T SAY verdict)."
  )
}

const agentSection = (score: AgentScore, config: JudgeConfig): string[] => {
  const lines: string[] = []
  lines.push(`### ${score.agentId} — ${score.label}`)
  lines.push('')

  // A flag seen only on the candidate is stated first whatever the verdict.
  const candidateFlags = score.flags.filter((f) => f.arm === 'candidate')
  const baseFlagTypes = new Set(
    score.flags.filter((f) => f.arm === 'base').map((f) => f.type),
  )
  const newFlags = candidateFlags.filter((f) => !baseFlagTypes.has(f.type))
  if (newFlags.length > 0) {
    lines.push(
      `> **${newFlags.length} flag(s) raised on the candidate only ` +
        `(counted once per case):** ` +
        `${[...new Set(newFlags.map((f) => f.type))].join(', ')}`,
    )
    lines.push('')
  }

  lines.push(
    `overall ${formatDelta(score.overall)} over ${score.overall.cases} ` +
      `cases — ${score.labelNote}`,
  )
  lines.push('')
  lines.push(
    '| dimension | Δ (95% CI) | cases | W/T/L (pairs) | ' +
      "can't tell (pairs) |",
  )
  lines.push('| --- | --- | --- | --- | --- |')
  lines.push(dimensionRow('overall', score.overall))
  for (const name of config.dimensions) {
    const dimension = score.dimensions[name]
    if (dimension !== undefined) lines.push(dimensionRow(name, dimension))
  }
  lines.push('')

  if (score.regressions.length > 0) {
    lines.push(
      `Regression on ${score.regressions.join(', ')} ` +
        '(upper bound below zero). This qualifies the verdict and does not ' +
        'change it.',
    )
    lines.push('')
  }

  const magnitudes = magnitudeLine(score.overall)
  if (magnitudes !== null) {
    lines.push(magnitudes)
    lines.push('')
  }
  const flags = flagLine(score)
  if (flags !== null) {
    lines.push(flags)
    lines.push('')
  }

  lines.push(...evidenceLines(score))
  lines.push('')
  lines.push(exclusionLine(score))
  lines.push('')
  lines.push(
    'Position consistency across order-swapped pairs: ' +
      `${percentOf(score.positionConsistency)}` +
      (score.orderUnstablePairs.length > 0
        ? `, order-unstable pair(s): ${score.orderUnstablePairs.join(', ')}`
        : ''),
  )
  if (score.panelDisagreementRate !== null) {
    lines.push(
      'Panel disagreement on direction, per judgment: ' +
        `${percentOf(score.panelDisagreementRate)}`,
    )
  }
  if (score.floorFailures.length > 0) {
    lines.push(
      `Absolute floor failed on ${score.floorFailures.length} run(s), ` +
        'one per arm per case: at least one arm produced something a ' +
        'reasonable user would not accept, which a tie would otherwise ' +
        'hide.',
    )
  }
  if (score.floorUnclear.length > 0) {
    lines.push(
      `Absolute floor unclear on ${score.floorUnclear.length} run(s), ` +
        'one per arm per case: the judge could not tell whether a ' +
        'reasonable user would accept what an arm produced. Not counted ' +
        'as a failure, and worth a read.',
    )
  }
  lines.push('')
  lines.push(changeLine(score.ci))
  return lines
}

// Always printed, even when nothing was judged. This is the anti-stall
// mechanic: a gap nobody can see is a gap nobody closes, so the number and
// the named blockers go out with every report.
export const coverageLines = (
  registry: readonly AgentEntry[] = AGENTS,
): string[] => {
  const { wired, judgeable, blocked } = coverage(registry)
  const lines = [`**Coverage: ${wired} of ${judgeable} agents wired.**`]
  for (const agent of blocked) {
    lines.push(`- blocked: ${agent.agentId} — ${agent.blockedReason}`)
  }
  return lines
}

export const renderReport = (
  report: SweepReport,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): string => {
  const lines: string[] = ['## Universal Judge', '']

  if (report.agents.length === 0) {
    lines.push('No agent produced a verdict in this sweep.')
    lines.push('')
  }
  for (const score of report.agents) {
    lines.push(...agentSection(score, config))
    lines.push('')
  }

  for (const refusal of report.refusals ?? []) {
    lines.push(`### ${refusal.agentId} — refused`)
    lines.push('')
    lines.push(refusal.reason)
    lines.push('')
  }

  lines.push(...coverageLines(report.registry))
  return lines.join('\n')
}

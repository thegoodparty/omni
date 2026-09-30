import { AGENTS, coverage, type AgentEntry } from './agents'
import { formatGap, type ArmGap } from './armGap'
import type { IdenticalOutputs } from './identicalOutputs'
import type { Interval } from './bootstrap'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { PRICING_VERSION } from './pricing'
import type { AgentScore, DimensionScore } from './score'
import type { CiContext, RunRecord } from './record'

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
  // When the two arms were captured, and how far apart. Absent on a report
  // rendered straight from records with no arm manifests, which is what a
  // fixture-driven test has.
  armGap?: ArmGap
  // Agents whose verdict rests on a case list marked as a placeholder. A
  // number drawn from inputs somebody wrote to exercise the pipeline is not
  // the same claim as one drawn from inputs somebody wrote to test the agent.
  placeholderCases?: readonly string[]
  // How many of each agent's pairs came back byte-identical. Evidence, not a
  // verdict: the refusal for an all-identical sweep arrives as a Refusal.
  identicalOutputs?: readonly IdenticalOutputs[]
  // Runs that queried the voter mart with no Delta version pinned. Empty or
  // absent on a sweep that either pinned the mart or never read it.
  unpinnedMart?: readonly UnpinnedMartReads[]
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

// The arms run sequentially and the report says so, because the alternative
// is a reader who assumes they were interleaved. See armGap.ts: two
// worktrees are two processes, so "base, candidate, base, candidate" is not
// available and the distance between the two captures is stamped instead.
export const armGapLines = (gap: ArmGap): string[] => {
  const [first, second] = gap.candidateFirst
    ? (['candidate', 'base'] as const)
    : (['base', 'candidate'] as const)
  return [
    '### Arm capture windows',
    '',
    'The arms are not interleaved in time. Each one is a separate process ' +
      'in a separate checkout, so the whole of one arm runs before any of ' +
      'the other. The gap below is how long anything outside the branch ' +
      'had to move between the two captures: a deploy, the voter table, ' +
      'the live web.',
    '',
    '| arm | started | ended |',
    '| --- | --- | --- |',
    `| base | ${gap.base.startedAt} | ${gap.base.endedAt} |`,
    `| candidate | ${gap.candidate.startedAt} | ${gap.candidate.endedAt} |`,
    '',
    `Order: ${first} then ${second}. Gap between the captures: ` +
      `${formatGap(gap)}.`,
    ...(gap.farApart
      ? [
          '',
          '> **The arms are far apart.** This comparison is between two ' +
            'captures taken a long way from each other, so a difference it ' +
            'reports may belong to whatever changed in between rather than ' +
            'to the branch. Re-capture both arms together to settle it.',
        ]
      : []),
  ]
}

export const identicalOutputLines = (
  results: readonly IdenticalOutputs[],
): string[] => [
  '### Identical outputs',
  '',
  'Pairs whose two arms produced the same output. A few are ordinary — a ' +
    'deterministic agent answering a question the branch did not touch will ' +
    'match. All of them means the candidate never reached the agent, which ' +
    'is refused above rather than reported as SAME.',
  '',
  '| agent | identical pairs | cases |',
  '| --- | --- | --- |',
  ...results.map(
    (r) =>
      `| ${r.agentId} | ${r.identical} of ${r.of} | ` +
      `${r.caseIds.length === 0 ? 'none' : r.caseIds.join(', ')} |`,
  ),
]

// WHICH RUNS THE MISSING PIN ACTUALLY COST SOMETHING.
//
// `JUDGE_DATA_VERSION` may be unset for an ordinary reason — no Databricks
// credential on the job, a dead one, a history the warehouse would not hand
// over — and the sweep proceeds rather than refusing, because most agents
// never touch the mart and killing a whole paid sweep over an unpinnable
// table is the wrong trade. What it must not do is proceed as though pinned.
//
// A record is the evidence for both halves of that. `dataVersion` is stamped
// only when a version was pinned AND a query actually ran against it (see
// the runner), and `toolQueries` carries the SQL the agent wrote verbatim. So
// a record with queries and no `dataVersion` is a run that read the live mart
// while nothing was holding it still — and a verdict that turned on that
// run's constituent numbers is the one a reader has to discount. A run with
// no queries read no versioned table and is unaffected, which is why this is
// not simply "the pin was missing".
//
// Counted per agent because that is the grain a verdict is reported at: an
// agent whose runs never queried the mart is not qualified by this at all,
// and folding them together would qualify every verdict equally.
export interface UnpinnedMartReads {
  agentId: string
  // Distinct cases with at least one such run, so a reader can go and look at
  // the ones whose numbers may have moved.
  caseIds: readonly string[]
  // Runs, not cases: both arms and every attempt count, because each one is a
  // separate read of a mart that was free to change in between.
  runs: number
}

const readMartUnpinned = (record: RunRecord): boolean =>
  record.dataVersion === undefined && record.toolQueries.length > 0

export const unpinnedMartReads = (
  records: readonly RunRecord[],
): UnpinnedMartReads[] => {
  const byAgent = new Map<string, { caseIds: Set<string>; runs: number }>()
  for (const record of records) {
    if (!readMartUnpinned(record)) continue
    const entry = byAgent.get(record.agentId) ?? {
      caseIds: new Set<string>(),
      runs: 0,
    }
    entry.caseIds.add(record.caseId)
    entry.runs += 1
    byAgent.set(record.agentId, entry)
  }
  return [...byAgent.entries()].map(([agentId, entry]) => ({
    agentId,
    caseIds: [...entry.caseIds].sort(),
    runs: entry.runs,
  }))
}

// Said once, plainly, and then per agent. The first sentence is the one a
// reader needs whether or not they know what a Delta version is; the list
// under it is which verdicts it qualifies.
export const unpinnedMartLines = (
  reads: readonly UnpinnedMartReads[],
): string[] => [
  '> **The voter mart was not pinned to one version.** Both arms were meant ' +
    'to read the same snapshot of it. No version could be resolved for this ' +
    'sweep, so each arm read whatever the mart held when it ran \u2014 and the ' +
    'arms are separate processes that can be an hour apart. For the runs ' +
    'below, a difference in constituent numbers may belong to the data ' +
    'moving rather than to the branch, so discount any verdict that turned ' +
    'on one. Every other run in this report queried nothing versioned and ' +
    'is unaffected.',
  '>',
  ...reads.map(
    (read) =>
      `> - ${read.agentId}: ${read.runs} run(s) queried the mart unpinned, ` +
      `across case(s) ${read.caseIds.join(', ')}`,
  ),
]

// Takes the whole agent list and filters inside, rather than taking the
// already-degraded ones: "print nothing when the panel was whole" is the
// property most likely to be lost, so it lives in one place instead of at
// every call site.
//
// One line per agent, never per judgment. A verdict is reported per agent,
// so that is the grain at which "this rests on fewer opinions than it looks
// like" is something a reader can act on.
export const degradedPanelLines = (scores: readonly AgentScore[]): string[] => {
  const degraded = scores.flatMap((score) =>
    score.degradedPanel === null
      ? []
      : [{ agentId: score.agentId, panel: score.degradedPanel }],
  )
  if (degraded.length === 0) return []
  return [
    '> **Some verdicts came from a reduced judge panel.** A seat that throws ' +
      'is dropped rather than retried, so for the agents below the verdict ' +
      'was combined from the seats that answered and not from every seat the ' +
      'config asked for. Fewer opinions agree with each other more easily, ' +
      'so read the panel-disagreement rate for these agents as a floor and ' +
      'not as a measurement. Every other verdict in this report was reached ' +
      'by the whole panel.',
    '>',
    ...degraded.map(
      ({ agentId, panel }) =>
        `> - ${agentId}: ${panel.judgments} judgment(s) ran without ` +
        `seat(s) ${panel.seats.join(', ')}`,
    ),
  ]
}

export const placeholderLines = (agentIds: readonly string[]): string[] => [
  `> **Placeholder inputs:** ${agentIds.join(', ')}. These case lists exist ` +
    'to exercise the pipeline, not to test the agent, so treat the verdict ' +
    'as evidence that the judge ran rather than as evidence about the ' +
    'branch.',
]

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

  const placeholders = report.placeholderCases ?? []
  if (placeholders.length > 0) {
    lines.push(...placeholderLines(placeholders))
    lines.push('')
  }

  // Beside the placeholder warning rather than at the foot with the arm gap:
  // both qualify what the verdicts above can be read to mean, and a reader who
  // stops after the first agent section has to have seen it.
  const unpinned = report.unpinnedMart ?? []
  if (unpinned.length > 0) {
    lines.push(...unpinnedMartLines(unpinned))
    lines.push('')
  }

  // In the same block as the two above, and ahead of the refusals, the
  // identical-outputs table and the arm-gap footer: all three qualify how
  // the verdicts can be read, so they belong with each other rather than
  // among the report's reference sections.
  const degraded = degradedPanelLines(report.agents)
  if (degraded.length > 0) {
    lines.push(...degraded)
    lines.push('')
  }

  for (const refusal of report.refusals ?? []) {
    lines.push(`### ${refusal.agentId} — refused`)
    lines.push('')
    lines.push(refusal.reason)
    lines.push('')
  }

  const identical = report.identicalOutputs ?? []
  if (identical.length > 0) {
    lines.push(...identicalOutputLines(identical))
    lines.push('')
  }

  if (report.armGap !== undefined) {
    lines.push(...armGapLines(report.armGap))
    lines.push('')
  }

  lines.push(...coverageLines(report.registry))
  return lines.join('\n')
}

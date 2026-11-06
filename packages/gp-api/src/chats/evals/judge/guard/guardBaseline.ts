import { z } from 'zod'
import {
  armHandled,
  conditionHandling,
  handlingPairKey,
} from '../handling'
import { OVERALL, type Judgment } from '../judge'
import { orient } from '../score'

// A snapshot of main's own flakiness, built from a "no-change sweep" — a
// sweep dispatched from main against a PR with an empty commit, so both arms
// run identical code (Daniel, 2026-11-05: run 41973696104 for
// campaign_assistant is one). It exists so a WORSE on the guard check can
// show whether the moved case is flaky on main too, which is what makes a
// WORSE easier to rule on. Stored at `_judge/guard/baselines/<agentId>.json`
// — one file per agent, replaced by the next baseline run for that agent.
export const GUARD_BASELINES_PREFIX = '_judge/guard/baselines'

export const baselineKey = (agentId: string): string =>
  `${GUARD_BASELINES_PREFIX}/${agentId}.json`

export const GuardBaselineCaseSchema = z.object({
  caseId: z.string().min(1),
  // How many attempts this case ran in the baseline sweep, and how many of
  // them each arm handled — "met 2 of 3" is `candidateHandled: 2, attempts:
  // 3` (candidate here just means "the arm the dispatcher called candidate";
  // on a no-change sweep it ran main same as base).
  attempts: z.number().int().positive(),
  baseHandled: z.number().int().nonnegative(),
  candidateHandled: z.number().int().nonnegative(),
})
export type GuardBaselineCase = z.infer<typeof GuardBaselineCaseSchema>

export const GuardBaselineSchema = z.object({
  runId: z.string().min(1),
  agentId: z.string().min(1),
  date: z.string().datetime(),
  cases: z.array(GuardBaselineCaseSchema),
  // "How many control pairs the judge called a difference on" — the same
  // count report.ts's controlLines prints inline, extracted here so a
  // baseline can quote it without re-running a live sweep.
  controlPairsCalled: z.number().int().nonnegative(),
  controlPairsTotal: z.number().int().nonnegative(),
})
export type GuardBaseline = z.infer<typeof GuardBaselineSchema>

export interface GuardBaselineRefusal {
  refused: true
  reason: string
}

export const isGuardBaselineRefusal = (
  value: GuardBaseline | GuardBaselineRefusal,
): value is GuardBaselineRefusal => 'refused' in value

export interface BuildGuardBaselineInput {
  runId: string
  agentId: string
  date: string
  // Whether the base and candidate arms ran the same tree. The caller
  // decides this from git (`git diff --quiet <base>..<candidate>`), not
  // from the arm manifests: a wiring sweep's candidate commit is an empty
  // commit on top of base, so the two commits never share a SHA even when
  // every file is identical, and a SHA comparison would refuse the exact
  // sweeps this baseline exists to read.
  codeIdentical: boolean
  judgments: readonly Judgment[]
  // Case ids this agent's list marks `scored: false` — controls, which the
  // schema forbids from also carrying a `handledWhen` (cases.ts), so this
  // set and the handling counts above are always disjoint.
  controlCaseIds: ReadonlySet<string>
}

export const buildGuardBaseline = (
  input: BuildGuardBaselineInput,
): GuardBaseline | GuardBaselineRefusal => {
  if (!input.codeIdentical) {
    return {
      refused: true,
      reason:
        `the base and candidate arms of run ${input.runId} did not run the ` +
        'same code — a baseline needs a no-change sweep (both arms on ' +
        "main), not a sweep that judged a real change",
    }
  }

  const asked = new Set(
    input.judgments
      .filter((j) => j.kind === 'graded' && j.handled !== undefined)
      .map((j) => handlingPairKey(j.key.caseId, j.key.attempt)),
  )
  const handling = conditionHandling(input.judgments, asked)

  const byCase = new Map<
    string,
    { attempts: number; base: number; candidate: number }
  >()
  for (const c of handling.cases) {
    const entry = byCase.get(c.caseId) ?? {
      attempts: 0,
      base: 0,
      candidate: 0,
    }
    entry.attempts += 1
    if (armHandled(c.base)) entry.base += 1
    if (armHandled(c.candidate)) entry.candidate += 1
    byCase.set(c.caseId, entry)
  }

  const cases: GuardBaselineCase[] = [...byCase.entries()]
    .map(([caseId, { attempts, base, candidate }]) => ({
      caseId,
      attempts,
      baseHandled: base,
      candidateHandled: candidate,
    }))
    .sort((a, b) => a.caseId.localeCompare(b.caseId))

  const controlPrimaries = input.judgments.filter(
    (j) => j.key.order === 'primary' && input.controlCaseIds.has(j.key.caseId),
  )
  const controlPairsCalled = controlPrimaries.filter((j) => {
    if (j.kind !== 'graded') return false
    const overall = j.dimensions[OVERALL]
    if (overall === undefined) return false
    const oriented = orient(overall.verdict, j.slotMap)
    return oriented !== null && oriented !== 0
  }).length

  return {
    runId: input.runId,
    agentId: input.agentId,
    date: input.date,
    cases,
    controlPairsCalled,
    controlPairsTotal: controlPrimaries.length,
  }
}

// A case is "flaky on main" when the baseline shows it met on some but not
// all of its runs, or — the other half of the documented rule — when the
// baseline's two identical arms disagreed on it outright (one handled it,
// the other did not, on the same code). Both read as "do not trust this
// case's regression", which is the point of showing it beside a WORSE.
export const isFlakyOnMain = (entry: GuardBaselineCase): boolean =>
  (entry.baseHandled > 0 && entry.baseHandled < entry.attempts) ||
  (entry.candidateHandled > 0 && entry.candidateHandled < entry.attempts) ||
  entry.baseHandled !== entry.candidateHandled

// The heading guardVerdict.ts's resolveGuardVerdict looks for, so the guard
// job — which holds no AWS role and so can never read a baseline itself —
// still gets this content: judge.yml's sweep job (which DOES hold the role)
// appends it to the public report.md before the guard's own verdict step
// reads that file back.
export const GUARD_BASELINE_HEADING = '## Guard: main-vs-main baseline'

export interface MovedCase {
  agentId: string
  caseId: string
}

const formatAgentNote = (
  agentId: string,
  movedCaseIds: readonly string[],
  baseline: GuardBaseline | undefined,
): string[] => {
  const lines = [`### ${agentId}`]
  if (baseline === undefined) {
    lines.push(
      `No main-vs-main baseline for ${agentId}. Run \`judge baseline ` +
        '<runId>` on a no-change sweep (both arms on main) to create one.',
    )
    return lines
  }
  const byCaseId = new Map(baseline.cases.map((c) => [c.caseId, c]))
  for (const caseId of movedCaseIds) {
    const entry = byCaseId.get(caseId)
    if (entry === undefined) {
      lines.push(`- \`${caseId}\`: not in baseline run ${baseline.runId}`)
      continue
    }
    const flaky = isFlakyOnMain(entry) ? ', flaky on main' : ''
    lines.push(
      `- \`${caseId}\`: main's baseline handled it ` +
        `${entry.baseHandled}/${entry.attempts} (base) and ` +
        `${entry.candidateHandled}/${entry.attempts} (candidate)${flaky}`,
    )
  }
  lines.push(
    `Baseline run [\`${baseline.runId}\`], ${baseline.date}: the judge ` +
      `called a difference on ${baseline.controlPairsCalled} of ` +
      `${baseline.controlPairsTotal} control pair(s).`,
  )
  return lines
}

// One trailer covering every WORSE agent in the sweep, rather than text
// spliced into each agent's own section — simpler to generate and to find
// again from guardVerdict.ts, at the cost of repeating the heading's
// agent-id sub-sections instead of nesting under report.ts's own.
export const formatGuardBaselineTrailer = (
  agents: readonly {
    agentId: string
    movedCaseIds: readonly string[]
    baseline: GuardBaseline | undefined
  }[],
): string =>
  [
    GUARD_BASELINE_HEADING,
    '',
    ...agents.flatMap((a) => [
      ...formatAgentNote(a.agentId, a.movedCaseIds, a.baseline),
      '',
    ]),
  ]
    .join('\n')
    .trimEnd()

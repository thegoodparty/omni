import type { JudgeConfig } from './config'
import type { ConditionHandling } from './handling'
import type { AgentScore, VerdictLabel } from './score'
import { publicToolName } from './toolErrorDetails'
import type { AgentToolUse, ArmToolUse } from './toolUse'

// Two signals the quality delta cannot see, which may decide an agent's label
// on their own. The pairwise dimensions compare two outputs without the
// agent's own rules, so a probe that cut the system prompt in half read CAN'T
// SAY there, while handling showed 5 regressions to 0 and the candidate
// stopped calling tools the base called every run. And `isComparable()`
// excludes a chat pair with any tool error, so a candidate whose every tool
// call failed left the quality delta nothing to read at all.

export type SignalDirection = 'WORSE' | 'BETTER'

export interface HandlingSignal {
  regressions: number
  improvements: number
  // One-sided sign-test tails: P(X >= regressions) and P(X >= improvements)
  // for X ~ Binomial(regressions + improvements, 0.5).
  pWorse: number
  pBetter: number
  says: SignalDirection | null
}

// Tool names only, each through publicToolName: this lands on a public page.
export interface CaseToolChanges {
  caseId: string
  candidateOnlyFailures: readonly string[]
  baseOnlyFailures: readonly string[]
  dropped: readonly string[]
  added: readonly string[]
}

export interface ToolSignal {
  // Only cases with at least one change.
  cases: readonly CaseToolChanges[]
  says: SignalDirection | null
}

export interface RegressionSignals {
  // What the quality comparison alone said, before any signal applied.
  qualityLabel: VerdictLabel
  handling?: HandlingSignal
  tools?: ToolSignal
}

// P(X >= k) for X ~ Binomial(n, 0.5), exactly.
export const signTestTail = (k: number, n: number): number => {
  if (k <= 0) return 1
  if (k > n) return 0
  let coefficient = 1
  let tail = 0
  for (let i = 0; i <= n; i += 1) {
    if (i >= k) tail += coefficient
    coefficient = (coefficient * (n - i)) / (i + 1)
  }
  return tail / 2 ** n
}

export const handlingSignal = (
  handling: ConditionHandling,
  config: JudgeConfig,
): HandlingSignal => {
  const regressions = handling.cases.filter(
    (h) => h.class === 'regression',
  ).length
  const improvements = handling.cases.filter(
    (h) => h.class === 'improvement',
  ).length
  const n = regressions + improvements
  const pWorse = signTestTail(regressions, n)
  const pBetter = signTestTail(improvements, n)
  const { minChanges, alpha } = config.gates.handling
  const enough = n >= minChanges
  return {
    regressions,
    improvements,
    pWorse,
    pBetter,
    says:
      enough && pWorse <= alpha
        ? 'WORSE'
        : enough && pBetter <= alpha
          ? 'BETTER'
          : null,
  }
}

export const toolSignal = (
  toolUse: AgentToolUse,
  config: JudgeConfig,
): ToolSignal => {
  const { minRuns, minCases } = config.gates.toolFailures
  const cases = toolUse.cases.flatMap((c): CaseToolChanges[] => {
    // A case one arm never ran is new or retired, not a change in behavior.
    if (c.base.runs === 0 || c.candidate.runs === 0) return []
    const names = [
      ...new Set([
        ...Object.keys(c.base.tools),
        ...Object.keys(c.candidate.tools),
      ]),
    ].sort()
    const count = (arm: ArmToolUse, tool: string) =>
      arm.tools[tool] ?? { called: 0, errored: 0 }
    const where = (
      test: (base: number, candidate: number) => boolean,
      field: 'called' | 'errored',
    ): string[] => [
      ...new Set(
        names
          .filter((tool) =>
            test(count(c.base, tool)[field], count(c.candidate, tool)[field]),
          )
          .map((tool) => publicToolName(tool, 'chat')),
      ),
    ]
    // A failure counts only on a tool both arms called. A tool one arm
    // stopped calling, or newly reached for, is a dropped or added tool, not
    // a call that used to work and now fails (or the reverse).
    const failedOnly = (failing: ArmToolUse, other: ArmToolUse): string[] => [
      ...new Set(
        names
          .filter(
            (tool) =>
              count(failing, tool).errored >= minRuns &&
              count(other, tool).called >= minRuns &&
              count(other, tool).errored === 0,
          )
          .map((tool) => publicToolName(tool, 'chat')),
      ),
    ]
    const changes: CaseToolChanges = {
      caseId: c.caseId,
      candidateOnlyFailures: failedOnly(c.candidate, c.base),
      baseOnlyFailures: failedOnly(c.base, c.candidate),
      dropped: where(
        (base, candidate) => base >= minRuns && candidate === 0,
        'called',
      ),
      added: where(
        (base, candidate) => candidate >= minRuns && base === 0,
        'called',
      ),
    }
    const changed =
      changes.candidateOnlyFailures.length +
        changes.baseOnlyFailures.length +
        changes.dropped.length +
        changes.added.length >
      0
    return changed ? [changes] : []
  })
  const worse = cases.filter((c) => c.candidateOnlyFailures.length > 0).length
  const better = cases.filter((c) => c.baseOnlyFailures.length > 0).length
  return {
    cases,
    says: worse >= minCases ? 'WORSE' : better >= minCases ? 'BETTER' : null,
  }
}

export const combineVerdict = (
  quality: VerdictLabel,
  signals: readonly (SignalDirection | null)[],
): VerdictLabel => {
  if (quality === 'WORSE' || signals.includes('WORSE')) return 'WORSE'
  if (quality === 'BETTER' || signals.includes('BETTER')) return 'BETTER'
  return quality
}

// `handling` is whatever the sweep attached to the score, so a dry run, which
// attaches none, gets no handling signal.
export const withRegressionSignals = (
  score: AgentScore,
  toolUse: AgentToolUse | undefined,
  config: JudgeConfig,
): AgentScore => {
  const handling =
    score.handling === undefined
      ? undefined
      : handlingSignal(score.handling, config)
  const tools =
    score.shape === 'chat' && toolUse !== undefined
      ? toolSignal(toolUse, config)
      : undefined
  return {
    ...score,
    label: combineVerdict(score.label, [
      handling?.says ?? null,
      tools?.says ?? null,
    ]),
    signals: {
      qualityLabel: score.label,
      ...(handling !== undefined && { handling }),
      ...(tools !== undefined && { tools }),
    },
  }
}

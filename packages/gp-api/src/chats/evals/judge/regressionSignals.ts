import type { JudgeConfig } from './config'
import type { ConditionHandling } from './handling'
import type { AgentScore, VerdictLabel } from './score'

// A signal the quality delta cannot see, which may decide an agent's label on
// its own. The pairwise dimensions compare two outputs without the agent's own
// rules, so a probe that cut the system prompt in half read CAN'T SAY there,
// while handling showed 5 regressions to 0.

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

export interface RegressionSignals {
  // What the quality comparison alone said, before any signal applied.
  qualityLabel: VerdictLabel
  handling?: HandlingSignal
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

export const combineVerdict = (
  quality: VerdictLabel,
  handling: SignalDirection | null,
): VerdictLabel => {
  if (quality === 'WORSE' || handling === 'WORSE') return 'WORSE'
  if (quality === 'BETTER' || handling === 'BETTER') return 'BETTER'
  return quality
}

// `handling` is whatever the sweep attached to the score, so a dry run, which
// attaches none, gets no handling signal.
export const withRegressionSignals = (
  score: AgentScore,
  config: JudgeConfig,
): AgentScore => {
  const handling =
    score.handling === undefined
      ? undefined
      : handlingSignal(score.handling, config)
  return {
    ...score,
    label: combineVerdict(score.label, handling?.says ?? null),
    signals: {
      qualityLabel: score.label,
      ...(handling !== undefined && { handling }),
    },
  }
}

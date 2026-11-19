import type { JudgeConfig } from './config'
import {
  armHandled,
  type ArmHandling,
  type ConditionHandling,
} from './handling'
import type { AgentScore, VerdictLabel } from './score'

// A signal the quality delta cannot see, which may decide an agent's label on
// its own. The pairwise dimensions compare two outputs without the agent's own
// rules, so a probe that cut the system prompt in half read CAN'T SAY there,
// while the case checks showed the base meeting them far more often.

export type SignalDirection = 'WORSE' | 'BETTER'

export interface HandlingSignal {
  // Handled runs, summed over cases: how many of the base's runs met their
  // case's handledWhen, and how many of the candidate's.
  baseHandled: number
  candidateHandled: number
  runs: number
  // Exact one-sided tails of a within-case permutation test: P(a gap at
  // least this far toward the base) and toward the candidate.
  pWorse: number
  pBetter: number
  says: SignalDirection | null
}

export interface RegressionSignals {
  // What the quality comparison alone said, before any signal applied.
  qualityLabel: VerdictLabel
  handling?: HandlingSignal
}

const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0
  let result = 1
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i
  return result
}

// The distribution of (base handled - candidate handled) for one case when
// the arm makes no difference: the case's handled runs fall on base and
// candidate runs at random. Keyed by the difference.
const caseNull = (
  baseRuns: number,
  candidateRuns: number,
  handled: number,
): Map<number, number> => {
  const total = choose(baseRuns + candidateRuns, baseRuns)
  const dist = new Map<number, number>()
  for (let b = 0; b <= baseRuns; b += 1) {
    const weight =
      (choose(handled, b) *
        choose(baseRuns + candidateRuns - handled, baseRuns - b)) /
      total
    if (weight === 0) continue
    const gap = b - (handled - b)
    dist.set(gap, (dist.get(gap) ?? 0) + weight)
  }
  return dist
}

const convolve = (
  a: Map<number, number>,
  b: Map<number, number>,
): Map<number, number> => {
  const out = new Map<number, number>()
  for (const [x, px] of a) {
    for (const [y, py] of b) out.set(x + y, (out.get(x + y) ?? 0) + px * py)
  }
  return out
}

// Every run counts, but only against runs of its own case. The attempts of
// one case share an input, so they are compared to each other and never
// pooled across cases: under no change, which arm a case's handled runs
// landed on is a coin the permutation flips within that case. A case that
// went from 3 of 3 to 0 of 3 weighs more than one that went to 2 of 3, and
// a case both arms always pass or always fail adds nothing.
export const handlingSignal = (
  handling: ConditionHandling,
  config: JudgeConfig,
): HandlingSignal => {
  const byCase = new Map<string, { base: boolean[]; candidate: boolean[] }>()
  for (const h of handling.cases) {
    const graded = (arm: ArmHandling) =>
      arm.primary !== undefined || arm.swapped !== undefined
    if (!graded(h.base) || !graded(h.candidate)) continue
    const entry = byCase.get(h.caseId) ?? { base: [], candidate: [] }
    entry.base.push(armHandled(h.base))
    entry.candidate.push(armHandled(h.candidate))
    byCase.set(h.caseId, entry)
  }
  let baseHandled = 0
  let candidateHandled = 0
  let runs = 0
  let nullDist = new Map<number, number>([[0, 1]])
  for (const { base, candidate } of byCase.values()) {
    const b = base.filter(Boolean).length
    const c = candidate.filter(Boolean).length
    baseHandled += b
    candidateHandled += c
    runs += base.length
    nullDist = convolve(
      nullDist,
      caseNull(base.length, candidate.length, b + c),
    )
  }
  const observed = baseHandled - candidateHandled
  const tail = (keep: (gap: number) => boolean) =>
    Math.min(
      1,
      [...nullDist].reduce((sum, [gap, p]) => (keep(gap) ? sum + p : sum), 0),
    )
  const pWorse = tail((gap) => gap >= observed)
  const pBetter = tail((gap) => gap <= observed)
  const { alpha } = config.gates.handling
  return {
    baseHandled,
    candidateHandled,
    runs,
    pWorse,
    pBetter,
    says:
      observed > 0 && pWorse < alpha
        ? 'WORSE'
        : observed < 0 && pBetter < alpha
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

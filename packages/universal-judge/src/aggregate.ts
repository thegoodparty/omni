/**
 * Turn per-case verdicts into a verdict for the variant pair.
 *
 * This is function F from the Agent Evaluation Framework brief: direction, an
 * approximate magnitude, and the cost and latency deltas that make a quality
 * change readable as a trade-off rather than as a number on its own.
 *
 * Deliberately not a statistics package. "Exact/robust measures of magnitude" are
 * out of scope in the brief, so this reports a mean graded preference, an exact
 * binomial sign test, and an honest count of how often the judge contradicted
 * itself under order swap. A result that fails the stability check is reported as
 * inconclusive rather than dressed up with a p-value.
 */

import type { AgentResult, CaseVerdict, Margin, RunOutcome } from './types.js'

const POINTS: Record<Margin, number> = { much_better: 2, better: 1, tie: 0 }

/** Below this, a direction is not worth acting on even if the sign test likes it. */
export const MIN_DECISIVE_MEAN = 0.25

/** Above this share of order-flips the judge is not measuring anything stable. */
export const MAX_FLIP_RATE = 0.2

/**
 * Fewest non-tied cases that could ever reach p<0.05 on a two-sided sign test.
 *
 * The best a clean sweep of n cases can do is 2/2^n, which only crosses 0.05 at
 * n=6. Below that the arithmetic cannot distinguish a real difference from a coin,
 * however lopsided the tally looks — so no direction is reported, rather than one
 * that a reader would reasonably act on.
 */
export const MIN_POWERED_CASES = 6

export type Summary = {
  agent: string
  cases: number
  wins: number
  ties: number
  losses: number
  meanScore: number
  flipRate: number
  signTestP: number | undefined
  baselineCostUsd: number | undefined
  candidateCostUsd: number | undefined
  baselineDurationSeconds: number | undefined
  candidateDurationSeconds: number | undefined
  judgeCostUsd: number
  failures: RunOutcome[]
  verdict: string
  explanation: string
}

const stable = (verdicts: CaseVerdict[]) => verdicts.filter((v) => !v.flipped)

const signedScores = (verdicts: CaseVerdict[]) =>
  stable(verdicts).map((v) =>
    v.winner === 'candidate'
      ? POINTS[v.margin]
      : v.winner === 'baseline'
        ? -POINTS[v.margin]
        : 0,
  )

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0

const choose = (n: number, k: number) => {
  let result = 1
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i
  return result
}

/**
 * Two-sided exact binomial on non-tied stable verdicts, p=0.5. Answers only
 * "could this split have come from a coin?" — it says nothing about magnitude.
 */
export const signTest = (wins: number, losses: number): number | undefined => {
  const n = wins + losses
  if (n === 0) return undefined
  const k = Math.min(wins, losses)
  let tail = 0
  for (let i = 0; i <= k; i += 1) tail += choose(n, i)
  return Math.min(1, (2 * tail) / 2 ** n)
}

const meanOf = (
  runs: RunOutcome[],
  role: 'baseline' | 'candidate',
  field: 'costUsd' | 'durationSeconds',
) => {
  const values = runs
    .filter(
      (r) =>
        r.variant === role && r.status === 'ok' && typeof r[field] === 'number',
    )
    .map((r) => r[field] as number)
  return values.length ? mean(values) : undefined
}

export const summarise = (result: AgentResult): Summary => {
  const { verdicts, runs } = result
  const scored = stable(verdicts)
  const wins = scored.filter((v) => v.winner === 'candidate').length
  const losses = scored.filter((v) => v.winner === 'baseline').length
  const ties = scored.length - wins - losses
  const meanScore = mean(signedScores(verdicts))
  const flipRate = verdicts.length
    ? verdicts.filter((v) => v.flipped).length / verdicts.length
    : 0
  const signTestP = signTest(wins, losses)

  const { verdict, explanation } = headline({
    cases: verdicts.length,
    scored: scored.length,
    wins,
    ties,
    losses,
    meanScore,
    flipRate,
    signTestP,
  })

  return {
    agent: result.agent,
    cases: verdicts.length,
    wins,
    ties,
    losses,
    meanScore,
    flipRate,
    signTestP,
    baselineCostUsd: meanOf(runs, 'baseline', 'costUsd'),
    candidateCostUsd: meanOf(runs, 'candidate', 'costUsd'),
    baselineDurationSeconds: meanOf(runs, 'baseline', 'durationSeconds'),
    candidateDurationSeconds: meanOf(runs, 'candidate', 'durationSeconds'),
    judgeCostUsd: verdicts.reduce((sum, v) => sum + v.judgeCostUsd, 0),
    failures: runs.filter((r) => r.status !== 'ok'),
    verdict,
    explanation,
  }
}

const headline = (s: {
  cases: number
  scored: number
  wins: number
  ties: number
  losses: number
  meanScore: number
  flipRate: number
  signTestP: number | undefined
}) => {
  if (s.cases === 0) {
    return { verdict: 'no result', explanation: 'No cases were judged.' }
  }
  if (s.flipRate > MAX_FLIP_RATE) {
    return {
      verdict: 'inconclusive',
      explanation:
        `The judge reversed itself on ${pct(s.flipRate)} of cases when the two outputs ` +
        `were swapped, above the ${pct(MAX_FLIP_RATE)} bar. The outputs are too close to ` +
        `separate, or the rubric does not discriminate here.`,
    }
  }
  if (s.scored === 0) {
    return {
      verdict: 'inconclusive',
      explanation: 'Every case flipped under order swap.',
    }
  }

  const tally =
    `${s.wins} win / ${s.ties} tie / ${s.losses} loss for the candidate, mean graded ` +
    `preference ${signed(s.meanScore)} on a -2..+2 scale.`

  if (Math.abs(s.meanScore) < MIN_DECISIVE_MEAN) {
    return {
      verdict: 'no material change',
      explanation: `${tally} Too small to act on.`,
    }
  }

  // Run-to-run variance alone can sweep a handful of cases. Below the power floor
  // the tally is reported but no direction is claimed, because at this sample size
  // even a clean sweep cannot be told apart from chance.
  const decided = s.wins + s.losses
  if (decided < MIN_POWERED_CASES) {
    return {
      verdict: 'not enough cases to call',
      explanation:
        `${tally} Only ${decided} case(s) separated the two sides, and at that sample ` +
        `size even a clean sweep cannot reach p<0.05, so this is a direction to look ` +
        `into rather than a result. Re-run with at least ${MIN_POWERED_CASES} cases ` +
        `to get a verdict worth acting on.`,
    }
  }

  const direction = s.meanScore > 0 ? 'better' : 'worse'
  const strength = Math.abs(s.meanScore) >= 1 ? 'much ' : ''
  const sig =
    s.signTestP === undefined
      ? ''
      : s.signTestP < 0.05
        ? ` Sign test p=${s.signTestP.toFixed(3)}.`
        : ` Sign test p=${s.signTestP.toFixed(3)}, so this could still be chance.`

  return {
    verdict: `candidate is ${strength}${direction}`,
    explanation: `${tally}${sig}`,
  }
}

export const pct = (v: number) => `${Math.round(v * 100)}%`
export const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`

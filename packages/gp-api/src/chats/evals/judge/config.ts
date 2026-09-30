// Every tunable the shared middle has, in one file, because none of these
// values are known to be right yet. The design rule is that changing one is
// a file edit and never a code change: attempts per case, the practical
// margin, the case and consistency floors, the judge model and temperature,
// and whether the order-swap subsample runs.
//
// Values marked v0 were chosen rather than derived, and the rubric doc says
// to recalibrate them after the first ten comparisons.

// Injected wherever this code needs randomness, so a sweep is reproducible
// from a seed and a test can force an exact draw. Returns [0, 1).
export type Rng = () => number

export interface OrderSwapConfig {
  // Judging a pair in both orders is the only way to measure position bias,
  // and it costs a second judge call on every pair in the subsample.
  enabled: boolean
  // Share of a case list judged twice. v0: 0.2, from the rubric doc.
  fraction: number
}

export interface BootstrapConfig {
  iterations: number
  // 0.95 gives the 95% interval the report prints.
  confidence: number
}

export interface JudgeGates {
  // C_min. Below this the corpus verdict is CAN'T SAY whatever Δ says,
  // because agents are not deterministic: three Chief of Staff turns on
  // identical seeded state gave 6, 4 and 2 tool steps and replies of 1831,
  // 1135 and 1137 characters. A handful of cases measures that, not the
  // branch.
  minCases: number
  // δ, the practical margin. An effect smaller than this is real but not
  // worth acting on, and it reports as CAN'T SAY with that said explicitly.
  practicalMargin: number
  // Share of order-swapped pairs whose two orders must agree. Below it, the
  // judge is reading position rather than quality.
  consistencyFloor: number
  // Share of judgments allowed to come back cannot_determine.
  cannotDetermineCeiling: number
  // With more than one seat, the share of cases where seats may disagree on
  // the overall direction.
  panelDisagreementCeiling: number
}

export interface JudgePanelConfig {
  // One seat to start. A second from a different model family goes here once
  // calibration exists; when the two arms differ by vendor, at least one
  // seat should come from neither arm's family.
  //
  // Each seat pins exactly one model: jsonCompletion would otherwise fall
  // back down a shared list and every seat would converge on the first one.
  seats: readonly string[]
  // Nondeterminism belongs to the arms, not to the judge.
  temperature: number
}

export interface RenderConfig {
  // Cap on any one rendered block, input or output. Anything longer is cut
  // with an explicit marker. Applied identically to both arms, so it can
  // never favour one.
  maxRenderedChars: number
  // Replaced with `[assistant]` in rendered text. Model and provider names
  // are the identity leak a blind judge is most likely to act on. The
  // record's own model strings are stripped too, and from BOTH arms, so
  // this list only has to cover what an agent says about itself.
  identityPatterns: readonly RegExp[]
}

export interface JudgeConfig {
  // Attempts per case per arm. v0: 3. Attempt i of one arm pairs with
  // attempt i of the other; judging all k x k pairs is not the plan.
  attemptsPerCase: number
  // The dimension set the judge is asked for and scoring aggregates.
  //
  // v1 judges FINAL OUTPUTS ONLY — the trace is recorded but stays out of
  // the payload — so the two trace-dependent dimensions in the rubric
  // (correctness_support, execution_quality) are struck there and absent
  // here. Turning them on is this list plus the renderer, and stored
  // records can then be re-graded at zero agent cost.
  dimensions: readonly string[]
  panel: JudgePanelConfig
  gates: JudgeGates
  orderSwap: OrderSwapConfig
  bootstrap: BootstrapConfig
  render: RenderConfig
}

export const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  attemptsPerCase: 3,
  dimensions: ['task_success', 'instruction_adherence', 'user_utility'],
  panel: {
    seats: ['claude-sonnet-4-6'],
    temperature: 0,
  },
  gates: {
    minCases: 20,
    practicalMargin: 0.1,
    consistencyFloor: 0.7,
    cannotDetermineCeiling: 0.25,
    panelDisagreementCeiling: 0.3,
  },
  orderSwap: {
    enabled: true,
    fraction: 0.2,
  },
  bootstrap: {
    iterations: 2_000,
    confidence: 0.95,
  },
  render: {
    maxRenderedChars: 12_000,
    identityPatterns: [
      /\bclaude\b/gi,
      /\banthropic\b/gi,
      /\bgpt-?[0-9.]*\b/gi,
      /\bopenai\b/gi,
      /\bgemini\b/gi,
      /\b(?:sonnet|opus|haiku)\b/gi,
    ],
  },
}

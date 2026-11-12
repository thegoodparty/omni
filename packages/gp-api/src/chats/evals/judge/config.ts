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

// THE ONE SPEND SWITCH. Two gates read it — `spends()` in sweepEnv.ts, which
// decides whether an arm drives a real model, and `assertMaySpend` in
// runners/chatSeam.ts, which refuses to install the seam without a script.
// They were written on separate branches against different literals ('true'
// and '1'), so a live sweep failed closed on its first case with an error that
// named a developer mistake rather than the mismatch. Lives here because
// config.ts is the one module both layers already sit above.
//
// Only the exact string is affirmative: anything absent or garbled reads as
// "do not spend", so a mangled value costs a sweep that did not happen rather
// than one nobody asked for.
export const SPEND_ENV = 'JUDGE_SPEND'
export const SPEND_VALUE = 'true'

export const spendsRealMoney = (env: NodeJS.ProcessEnv): boolean =>
  env[SPEND_ENV] === SPEND_VALUE

export interface OrderSwapConfig {
  // Judging a pair in both orders is the only way to measure position bias,
  // and it costs a second judge call on every pair in the subsample.
  enabled: boolean
  // Share of a CHAT case list judged twice. v0: 0.2, from the rubric doc.
  fraction: number
  // Share of a BACKGROUND case list judged twice. Every case, because a
  // background case is a planted condition rather than a sample: one read of
  // it is the whole evidence for that condition, and a judge call costs cents
  // against a run's dollars. Every order flip on a bench reads as
  // disagreement this way, rather than as one confident wrong call. Absent
  // means `fraction`, which is what a hand-built config in a test gets.
  backgroundFraction?: number
}

export interface BootstrapConfig {
  iterations: number
  // 0.95 gives the 95% interval the report prints.
  confidence: number
}

export interface JudgeGates {
  // WHERE THE RESAMPLED INTERVAL TAKES OVER FROM THE EXACT COUNT. Under this
  // many scored cases the verdict comes from a sign test over the cases'
  // preferences (see `sign` and signTest in score.ts); from it up, from the
  // bootstrap interval. Not a floor: a short list still gets BETTER or WORSE
  // when its count is one chance can explain under `sign.alpha`.
  //
  // Eight, because that is where the interval stops over-calling on
  // one-attempt data. Resampling a handful of case scores reads tighter than
  // the evidence: three cases all for the base give the interval [-1, -1], a
  // point that "excludes zero" though 3 of 3 happens one time in eight by
  // chance, and at seven cases 6 of 7 still reads WORSE at one in sixteen.
  // From eight on, the only splits the interval calls that the sign test
  // refuses sit within a hundredth of alpha, and only on some seeds
  // (bootstrapCutover.test.ts checks every split up to twenty cases), and
  // the interval adds what a count cannot: the margin and SAME.
  bootstrapMinCases: number
  // The exact test under `bootstrapMinCases`. One-sided tails, like
  // `handling`: BETTER or WORSE only when the count of cases favouring one
  // arm has a null probability under alpha. Five cases all one way is 1/32;
  // four is 1/16 and never decides.
  sign: { alpha: number }
  // δ, the practical margin. An effect smaller than this is real but not
  // worth acting on, and it reports as CAN'T SAY with that said explicitly.
  practicalMargin: number
  // Share of order-swapped pairs whose two orders must agree. Below it, the
  // judge is reading position rather than quality.
  //
  // Only applied once there are `minSwappedPairs` of them: a rate has to have
  // a denominator before it can fail anything.
  consistencyFloor: number
  // HOW MANY ORDER-SWAPPED PAIRS THE FLOOR NEEDS before it means anything.
  // `orderSwap.fraction` is 0.2, so the first live sweep judged 24 pairs and
  // swapped 5 of them — and "60%" was 3 of 5, which the floor of 0.7 would
  // have failed a whole sweep on. Below this many, the rate is reported with
  // its denominator and gates nothing.
  //
  // 10 is a floor on sample size, not a statistical guarantee. It is chosen to
  // be reachable at the scale this config designs for — an eight-case chat
  // list at attemptsPerCase 3 is 24 pairs, so about 5 swapped, and a list
  // has to grow past that for the floor to bite.
  minSwappedPairs: number
  // Share of judgments allowed to come back cannot_determine.
  cannotDetermineCeiling: number
  // With more than one seat, the share of cases where seats may disagree on
  // the overall direction.
  panelDisagreementCeiling: number
  // Refuse an agent whose every judgeable pair came back byte-identical. The
  // candidate was not applied, and reporting that as SAME is the one failure
  // mode indistinguishable from a real verdict. Default true: a false alarm
  // on a genuinely inert change costs a re-read, a false SAME costs a wrong
  // decision. See identicalOutputs.ts.
  failOnAllIdenticalOutputs: boolean
  // The regression signal beside the quality delta (see
  // regressionSignals.ts). Counts discrete events rather than a noisy
  // pairwise preference, so it reads on its own test. A probe that cut
  // the agent's system prompt in half read CAN'T SAY on quality while
  // handling showed the base meeting its checks far more often.
  //
  // The one-sided p-value a within-case permutation test over handled runs
  // must come in under. One case going from 3 of 3 to 0 of 3 is exactly
  // 0.05, so a single case never decides the label. See regressionSignals.ts.
  handling: { alpha: number }
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
  //
  // IT HAS TO FIT THE EVIDENCE, not just bound the prompt. A background
  // agent's input is a captured payload of web sources — the real
  // race_opponent_summary fixtures are 26-51KB each — and several probes ask
  // whether the agent handled one source among six correctly: a conflicting
  // pair, a planted instruction, an archived page. Cut at 12,000 characters
  // the judge read about a quarter of that and would have scored those probes
  // on evidence it never saw, which reads as the probe failing to separate
  // rather than as the cap. Truncation is still reported per run, so a block
  // that does hit the cap is visible rather than silent.
  maxRenderedChars: number
  // Replaced with `[assistant]` in rendered text. Model and provider names
  // are the identity leak a blind judge is most likely to act on. The
  // record's own model strings are stripped too, and from BOTH arms, so
  // this list only has to cover what an agent says about itself.
  identityPatterns: readonly RegExp[]
}

export interface ArmGapConfig {
  // The two arms cannot be interleaved in time — each is a separate process
  // in a separate checkout, so all of base runs and then all of candidate —
  // so the report stamps the distance between the two captures instead. Past
  // this many hours it is flagged: whatever moved in between (a deploy, the
  // Delta table, the live web) had that long to move. A cached background
  // base arm is the case that blows through it.
  maxHours: number
}

// WHAT ONE SHAPE MAY SPEND, where the two shapes differ by three orders of
// magnitude. A chat case is a handful of model turns — seconds, cents. A
// background case is a Fargate task doing real research against a declared
// timeout of up to an hour, at dollars a run.
//
// At the chat budget a single background agent is 8 cases x 3 attempts = 24
// runs per arm, which is twenty-six hours of wall clock against a job allowed
// three, and up to $384 to judge one agent (48 runs across both arms at ~$8
// a run, the price planCost.ts puts on an agent never measured in a judge
// sweep). So background carries its own numbers rather than inheriting them.
export interface ShapeBudget {
  attemptsPerCase: number
  // The first n cases of the list, or the whole list when absent. A cap
  // rather than a separate shorter list: the case files stay the full set, so
  // raising this is a config change and not an authoring job.
  maxCases?: number
  // How many runs one arm may have in flight at once. Every run of every
  // admitted agent starts together, so this is also how many runs an arm may
  // walk at all: admission fills the slots and refuses the rest by name.
  //
  // Bounded well below the platform's own cap, which is shared. The dev
  // scheduler launches at most MAX_CONCURRENT_AGENTS tasks (50 by default)
  // across everything running there, and a run queued behind that cap is
  // waiting outside its own timeout, so the sweep's poll can give up on a run
  // that never started. Twelve leaves the rest of dev most of the room.
  //
  // PER SWEEP, NOT IN TOTAL, and one live sweep at a time is what keeps
  // those the same number. judge.yml's `sweep` job takes a single group for
  // the whole repository when the request is live, so a second PR's sweep
  // queues behind the first instead of running beside it. Before that, four
  // PRs judged at once could put 48 runs out, and with anything else on dev
  // that reaches the cap: runs queue, their polls time out as infra errors,
  // and the task still launches and bills with nothing waiting for it. So
  // raise this against the shared cap, not against one sweep's appetite.
  maxInFlight: number
}

// THE MOST ATTEMPTS A BACKGROUND CASE LIST MAY ASK FOR in its header. A list
// sets its own because the agents differ by an order of magnitude in what a
// run costs: three attempts of opportunities_and_challenges is about $10, of
// race_opponent_actions about $36. Bounded here rather than per list, so a
// header cannot quietly put a sweep past what the plan step priced; a list
// asking for more is refused by name rather than clamped.
export const MAX_LIST_ATTEMPTS_PER_CASE = 3

export interface JudgeConfig {
  // Attempts per case per arm. v0: 3. Attempt i of one arm pairs with
  // attempt i of the other; judging all k x k pairs is not the plan.
  //
  // This is the CHAT budget. Background takes `background` below.
  attemptsPerCase: number
  // Overrides attemptsPerCase for background agents, and caps their case
  // list. See ShapeBudget for why they are not the same numbers.
  //
  // FIVE CASES IS THE FEWEST THAT CAN DECIDE. At one attempt a background
  // comparison is one pair per case, and the verdict under
  // `gates.bootstrapMinCases` is a sign test over those pairs: 5 of 5 one
  // way is p = 1/32, under `gates.sign.alpha`; 3 of 3 was 1/8, so at the old
  // cap of 3 no background agent could ever read anything but CAN'T SAY.
  // Five costs two more runs an arm per agent, and fills an arm's twelve
  // in-flight slots with two agents rather than four.
  background: ShapeBudget
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
  armGap: ArmGapConfig
}

export const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  attemptsPerCase: 3,
  background: { attemptsPerCase: 1, maxCases: 5, maxInFlight: 12 },
  dimensions: ['task_success', 'instruction_adherence', 'user_utility'],
  panel: {
    seats: ['claude-sonnet-4-6'],
    temperature: 0,
  },
  gates: {
    bootstrapMinCases: 8,
    sign: { alpha: 0.05 },
    practicalMargin: 0.1,
    consistencyFloor: 0.7,
    minSwappedPairs: 10,
    cannotDetermineCeiling: 0.25,
    panelDisagreementCeiling: 0.3,
    failOnAllIdenticalOutputs: true,
    handling: { alpha: 0.05 },
  },
  orderSwap: {
    enabled: true,
    fraction: 0.2,
    backgroundFraction: 1,
  },
  bootstrap: {
    iterations: 2_000,
    confidence: 0.95,
  },
  armGap: {
    // v0. Two arms driven back to back are minutes apart, so this is loose
    // enough not to cry wolf and tight enough to catch a base arm captured
    // on another day.
    maxHours: 6,
  },
  render: {
    maxRenderedChars: 60_000,
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

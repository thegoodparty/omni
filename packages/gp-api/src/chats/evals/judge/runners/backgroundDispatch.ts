import { z } from 'zod'
import { findAgent, type AgentEntry } from '../agents'
import type { JudgeConfig } from '../config'
import type { PlaceholderValues } from '../caseParams'
import { missingValues, substituteBackgroundCases } from '../caseParams'
import type { BackgroundCase, CaseList } from '../cases'
import {
  caseTurns,
  isChatCase,
  loadBackgroundCases,
  loadCaseList,
} from '../cases'
import type { ArmCaseRequest } from '../sweepArm'
import type { ArmEnv } from '../sweepEnv'
import { armConfigFor, backgroundDestinationFrom } from '../sweepEnv'
import { JUDGE_FIXTURE } from '../judgeFixtureIdentity'
import { agentConfigFor } from './agentConfig'
import type { AgentConfig, BackgroundRunInput } from './background'

// EVERY ARGUMENT A BACKGROUND DISPATCH IS BUILT FROM, in one pure function.
//
// It lives here rather than inline in the arm suite because that suite is
// `describe.skipIf(!sweepRequested)` — it does not execute in CI, so nothing
// read these arguments. Two deliberate mis-wirings proved it: swapping
// `metadataBucket` and `artifactBucket`, and hardcoding one agent id in place
// of `request.agent.agentId`. Both typecheck, both survived the whole suite,
// and either one would be discovered by staging a sweep's config into the
// artifact bucket or by judging the wrong agent — after the money was spent.
//
// Pure, and takes the already-parsed env rather than reading `process.env`, so
// one `toEqual` over the returned object covers the lot.

// The slack between an agent's own budget and when the poll gives up. A run
// that is still inside its declared `timeout_seconds` has not failed, and
// abandoning it there costs the full price of a run and records an infraError
// that is excluded from the delta — the worst of both. The headroom covers
// Fargate task placement and the artifact upload, neither of which is inside
// the agent's own timer.
export const POLL_HEADROOM_MS = 5 * 60 * 1000

// One arm's wall clock for an agent from the two raw facts it turns on. Raw on
// purpose: the base ref's files are read by the CANDIDATE's code, and running
// the candidate's validators over them would refuse a base list in an older
// but valid format — the drift that has broken this stack before. A case count
// and a timeout are the only things the budget needs.
export const pollTimeoutMsFor = (timeoutSeconds: number): number =>
  timeoutSeconds * 1000 + POLL_HEADROOM_MS

// The whole budget one arm may spend. The sweep job's `timeout-minutes: 180`
// holds BOTH arms one after the other plus the judging step, so an arm gets
// well under half of it; judgeWorkflow.test.ts asserts two of these fit in
// the job. A background agent that would overrun it is refused by name —
// by armBudget.ts on a sweep, by caseLoaderFor's own spend-down on a local
// run — rather than cut off partway, which would write no manifest and leave
// the judging step failing on a missing arm.
//
// The chat half of the arm is bounded against it too, separately: chat
// agents walk while the background runs are out, so the arm takes the
// longer of the two rather than their sum. See CHAT_TURN_MS.
export const ARM_BUDGET_MS = 70 * 60 * 1000

// ONE CHAT TURN'S WALL CLOCK, as planned for, per agent.
//
// Chat agents walk one turn after another and nothing times a turn out, so
// a selection with more turns than an arm holds ran into the vitest timeout,
// which kills the arm with no manifest and orphans every background run
// still out. `all` is 5 agents x 8 cases x 3 attempts = 120 turns an arm.
//
// Measured, not chosen: chief_of_staff from the first live sweep (run
// 36999748321), 48 turns averaging 12.0s, the slowest 32s, and 24 turns in
// 5.0 and 4.6 minutes of arm. ordinance_flow from one 94s step
// (implementation notes, 2026-09-28). Each is planned at about 1.3-1.6x that,
// because one slow arm overrunning costs the whole sweep.
//
// An agent nobody has timed is planned at the slowest measured class, not
// the cheapest. priority_flow runs up to 30 tool steps a turn, and guessing
// low is the failure this exists to stop; refusing by name costs one agent.
export const CHAT_TURN_MS: Readonly<Partial<Record<string, number>>> = {
  chief_of_staff: 20_000,
  ordinance_flow: 120_000,
}
export const UNMEASURED_CHAT_TURN_MS = 120_000

export const chatTurnMsFor = (agentId: string): number =>
  CHAT_TURN_MS[agentId] ?? UNMEASURED_CHAT_TURN_MS

// What armBudget.ts probes the base tree for before it refuses any chat
// agent. A base arm without it walks every chat agent whatever it is told,
// so refusing one on the candidate alone would only pay the base for turns
// that pair with nothing.
export const CHAT_TIME_BOUNDED = true

// Deliberately NOT a fallback for a manifest with no timeout. `timeout_seconds`
// is in agentConfigFor's REQUIRED_FIELDS, so an agent that reaches here has
// one; a default would only serve to make a future loosening of that silent.
// Parsed rather than asserted, for the reason the projection is: the manifest
// is a file on disk whose shape this module does not control.
const StagedManifestSchema = z.object({
  model: z.string().optional(),
  timeout_seconds: z.number().optional(),
})

const stagedManifest = (
  config: AgentConfig,
): z.infer<typeof StagedManifestSchema> =>
  StagedManifestSchema.parse(JSON.parse(config.manifest))

const pollTimeoutMs = (config: AgentConfig): number => {
  const { timeout_seconds } = stagedManifest(config)
  if (timeout_seconds === undefined || timeout_seconds <= 0) {
    throw new Error(
      `the published manifest declares timeout_seconds ` +
        `"${String(timeout_seconds)}", which is not a budget this sweep can ` +
        'wait out',
    )
  }
  return pollTimeoutMsFor(timeout_seconds)
}

// The model the agent will actually run with, read from the manifest rather
// than written as a literal here. A literal would disagree with the manifest
// the override stages the moment either moves, and the disagreement would show
// up as a cost delta attributed to the wrong model.
const modelOf = (config: AgentConfig): string => {
  const { model } = stagedManifest(config)
  if (model === undefined || model === '') {
    throw new Error(
      'the published manifest names no model, so the run could not be priced',
    )
  }
  return model
}

// The cases an arm will actually walk for an agent: the first `maxCases` of
// its list, as the loader caps them. A value only a later case needs is not
// a reason anything was refused.
export const walkedBackgroundCases = (
  agent: AgentEntry,
  env: ArmEnv,
  load: (agent: AgentEntry) => BackgroundCase[] = loadBackgroundCases,
): BackgroundCase[] => {
  const all = load(agent)
  const { maxCases } = armConfigFor(env).background
  return maxCases === undefined ? all : all.slice(0, maxCases)
}

// WHETHER A BACKGROUND AGENT IS REFUSED BY DESIGN, before anything is staged:
// the sweep did not admit it, resolved no identifiers for it, or could not
// resolve the queue to dispatch it to. Each of those is refused by name
// further in — by the loader or by backgroundRunInputFor below — and each is
// an ordinary sweep, not a failed one.
//
// The queue alone of the three destination values, because it alone is
// resolved at run time and allowed to fail: judge.yml looks it up and warns
// when it cannot. The two buckets are written into the workflow, so a
// missing one is a dropped line, and that stays a red arm.
//
// Not the local spend-down refusal. A local run has no admitted list and its
// loader refuses an agent that overruns the arm, which still turns that run
// red; CI always resolves an admitted list, so it never reaches that path.
//
// And an agent whose walked cases need a value the sweep could not resolve:
// a race id goes missing whenever the named election has passed, and the
// loader then refuses exactly the lists that need one.
//
// A chat agent is refused by design only when the resolver named it, which
// it does for chat turns that would not fit the arm.
export const refusedBeforeSpend = (
  agent: AgentEntry,
  env: ArmEnv,
  casesFor: (agent: AgentEntry) => readonly Pick<BackgroundCase, 'params'>[] = (
    one,
  ) => walkedBackgroundCases(one, env),
): boolean =>
  agent.shape === 'background'
    ? (env.backgroundAdmitted !== undefined &&
        !env.backgroundAdmitted.has(agent.agentId)) ||
      // Also what a resolution that silently produced nothing looks like, and
      // it is meant to: that sweep still judges its chat agents. Read
      // through fixtureValuesFor, so an agent that dispatches as the seeded
      // fixture is judged on the values it actually uses, not the sweep's.
      fixtureValuesFor(agent, env.fixtureValues).orgSlug === undefined ||
      env.dispatchQueueUrl === undefined ||
      (agent.cases !== null &&
        missingValues(
          casesFor(agent),
          fixtureValuesFor(agent, env.fixtureValues),
        ).length > 0)
    : env.backgroundRefused?.has(agent.agentId) === true

// THE AGENTS AN ARM MUST HAVE CAPTURED, for the arm suite's final check. A
// skip of any of these is paid work that did not happen, and the suite turns
// it into a red job. Here rather than in the suite, which CI skips, so the
// rule is exercised where it can fail.
//
// An agent refused by design is left out. Red over one, the base arm skips
// the candidate arm (which runs only after a green base), and every chat
// agent already paid for on the base pairs with nothing.
export const capturableAgents = (
  requested: readonly string[],
  env: ArmEnv,
  find: (agentId: string) => AgentEntry | undefined,
  // Required, because a local run's chat refusals are worked out from it:
  // left out, a deliberate refusal would read as a failed capture.
  config: JudgeConfig,
  casesFor?: Parameters<typeof refusedBeforeSpend>[2],
): string[] => {
  const decided = withChatRefusals(env, config, find)
  return requested.filter((id) => {
    const entry = find(id)
    // Explicit rather than left to optional chaining: an id the registry
    // cannot resolve is refused outright by captureArm, so it can never be
    // in a manifest and must not be expected there.
    if (entry === undefined) return false
    // Before the refusal check, which reads the list: a blocked agent or one
    // with no list was never going to be captured either way.
    if (entry.cases === null || entry.status === 'blocked') return false
    return !refusedBeforeSpend(entry, decided, casesFor)
  })
}

// THE PLACEHOLDER VALUES ONE AGENT'S CASES ARE FILLED FROM. An agent that
// reads gp-api runs against the seeded fixture organization rather than the
// per-sweep slug, and its params have to name the same organization the
// dispatch does, or the artifact would echo one slug while the reads used
// another.
export const fixtureValuesFor = (
  agent: Pick<AgentEntry, 'readsGpApi'>,
  values: PlaceholderValues,
): PlaceholderValues =>
  agent.readsGpApi === true
    ? { ...values, orgSlug: JUDGE_FIXTURE.orgSlug }
    : values

export const backgroundRunInputFor = (
  request: ArmCaseRequest,
  env: ArmEnv,
  loadConfig: (agentId: string) => AgentConfig = agentConfigFor,
  intervalMs = 10 * 1000,
): BackgroundRunInput => {
  if (isChatCase(request.case)) {
    throw new Error(
      `${request.case.caseId} carries no params, so it is a chat case and ` +
        'not a background one',
    )
  }
  const destination = backgroundDestinationFrom(env)
  const orgSlug = fixtureValuesFor(request.agent, env.fixtureValues).orgSlug
  // Refused by name BEFORE anything is staged or sent. The dispatch builder
  // enforces the `judge-` prefix itself, but its message is about a slug it
  // was handed; this one is about the sweep not having resolved its
  // identifiers, which is the actual fault and names the step that fixes it.
  if (orgSlug === undefined) {
    throw new Error(
      `${request.agent.agentId} is a background agent and this sweep ` +
        'resolved no judge identifiers, so there is no judge- slug to ' +
        "dispatch against; see the 'Resolve the background agents' " +
        "identifiers' step and judgeIdentifiers.ts",
    )
  }
  const config = loadConfig(request.agent.agentId)
  return {
    sweepId: request.sweepId,
    agentId: request.agent.agentId,
    arm: request.arm,
    attempt: request.attempt,
    agentCase: request.case,
    // Built from the published manifest rather than passed through: a judge
    // run may change what the agent is told to do, never what it is allowed
    // to touch.
    config,
    variant: { ...request.variant, model: modelOf(config) },
    ...(request.agent.readsGpApi === true
      ? {
          organizationSlug: JUDGE_FIXTURE.orgSlug,
          clerkUserId: JUDGE_FIXTURE.clerkUserId,
        }
      : { organizationSlug: orgSlug }),
    metadataBucket: destination.metadataBucket,
    artifactBucket: destination.artifactBucket,
    poll: { timeoutMs: pollTimeoutMs(config), intervalMs },
    ...(env.dataVersion !== undefined && { dataVersion: env.dataVersion }),
  }
}

// THE CASE LOADER A SWEEP WALKS WITH, which is not the raw one.
//
// Six of the fifteen background case lists carry `{judgeOrgSlug}` or
// `{judgeRaceId}` in their params. Walking those unsubstituted reaches
// `assertNoPlaceholders` at the dispatch builder, which throws on case 1 —
// and `captureArm`'s per-agent catch turns that into a named skip, so the
// agent is dropped with a message about a bad placeholder rather than about
// missing wiring. Every one of those six, on every sweep, silently.
//
// Substituted PER AGENT over the WHOLE list before any of it is walked, which
// is what `substituteBackgroundCases` is for: per-case substitution would pay
// for cases 1-7 and then die on case 8.
export interface BackgroundBudgetInput {
  budgetMs: number
  attemptsPerCase: number
  maxCases: number | undefined
  // How many runs may be in flight at once, which on a local run is also how
  // many it may walk; see ShapeBudget.maxInFlight.
  maxInFlight: number
  // WHICH BACKGROUND AGENTS THIS ARM MAY WALK, decided once for both arms.
  //
  // Absent on a local run, where the arm decides for itself by spending its
  // own budget down. Present on a sweep, where `armBudget.ts` decided before
  // either arm ran — because each arm reads timeouts from its own worktree,
  // and two arms deciding separately disagree the moment a branch changes
  // one: one admits an agent the other refuses, the spend-down then pushes
  // the disagreement onto every agent after it in walk order, and both arms
  // bill for runs that pair with nothing. Empty means nothing was admitted,
  // which is not the same as absent.
  admitted?: ReadonlySet<string>
  // WHY each refused agent was refused, as the resolver decided it. Carried
  // so the refusal an arm records — and the report shows — says "would take
  // 75 minutes on the slower arm" rather than "see the step log".
  //
  // For a CHAT agent it is also the decision: chat agents are walked unless
  // named here, because the resolver refuses one only for its turns not
  // fitting the arm.
  refusedReasons?: ReadonlyMap<string, string>
}

export interface CaseLoaderDeps {
  load?: typeof loadCaseList
  loadBackground?: typeof loadBackgroundCases
  loadConfig?: (agentId: string) => AgentConfig
}

export const caseLoaderFor = (
  values: PlaceholderValues,
  budget: BackgroundBudgetInput,
  {
    load = loadCaseList,
    loadBackground = loadBackgroundCases,
    loadConfig = agentConfigFor,
  }: CaseLoaderDeps = {},
): ((agent: AgentEntry) => CaseList) => {
  const {
    budgetMs,
    attemptsPerCase,
    maxCases,
    maxInFlight,
    admitted,
    refusedReasons,
  } = budget
  if (maxCases !== undefined && maxCases < 1) {
    throw new Error(
      `the background case cap is ${maxCases}, which is not a number of ` +
        'cases a sweep can walk: 0 judges nothing while reporting a clean ' +
        'arm, and a negative one is read by slice as "all but the last" — ' +
        'nearly the whole list, which is the opposite of a cap',
    )
  }
  // THE SLOTS ARE SPENT DOWN ACROSS AGENTS, not re-offered to each one, and
  // created ONCE PER LOADER — so once per arm, since the arm builds one.
  // captureArm starts every admitted background run at once, so a per-agent
  // check against all the slots says yes to four agents that each fit and
  // together put four times the runs in flight.
  const remaining = { slots: maxInFlight }
  return (agent) => {
    const list = load(agent)
    if (list.shape !== 'background') {
      // Thrown from here for the reason the background refusal below is.
      const why = refusedReasons?.get(agent.agentId)
      if (why !== undefined) {
        throw new Error(
          `${agent.agentId} was not admitted to this sweep: ${why}`,
        )
      }
      return list
    }
    // ADMISSION FIRST, before anything else is read. A refused agent must be
    // refused as refused: checked after substitution, an agent that was never
    // going to run surfaced as an unsubstituted-placeholder error instead,
    // and the report named the wrong cause.
    if (admitted !== undefined && !admitted.has(agent.agentId)) {
      const why = refusedReasons?.get(agent.agentId)
      throw new Error(
        `${agent.agentId} was not admitted to this sweep: ` +
          (why ??
            'the budget decided once for both arms before either ran left ' +
              "no room for it — see the 'Resolve the background case and " +
              "attempt budget' step"),
      )
    }
    // CAPPED BEFORE SUBSTITUTION AND BEFORE THE BUDGET CHECK, so the budget
    // is measured against what will actually be walked rather than the file.
    // The FIRST n rather than a sample, so both arms take the same cases.
    // Re-read once per agent to get the loader's own narrowing rather than a
    // fourth structural one.
    const all = loadBackground(agent)
    const cases = substituteBackgroundCases(
      maxCases === undefined ? all : all.slice(0, maxCases),
      fixtureValuesFor(agent, values),
    )
    const config = loadConfig(agent.agentId)
    // Reached here rather than at the dispatch, where a manifest naming no
    // model would arrive as a skip on case 1 with every agent walked before
    // it already billed. Before the slots are taken, so an agent refused for
    // it leaves them to the agents after it.
    modelOf(config)
    if (admitted === undefined) {
      // Refused BEFORE deducting, so a refused agent leaves its share for
      // the ones after it.
      const runs = cases.length * attemptsPerCase
      const why = waveRefusal(
        runs,
        pollTimeoutMs(config),
        remaining.slots,
        budgetMs,
        maxInFlight,
      )
      // PER AGENT, AND THROWN FROM INSIDE THE LOADER ON PURPOSE.
      //
      // `captureArm` calls `loadCases(agent)` inside its per-agent try/catch, so a
      // throw here becomes a named entry in the manifest's `skipped` list and THE
      // REST OF THE SWEEP CONTINUES. That placement is the whole design:
      //
      // An earlier version checked the whole selection at the top of the arm and
      // threw before `captureArm`. Every one of the fifteen background agents
      // overruns any plausible job budget on its own — the cheapest is six hours of
      // wall clock, meeting_briefing twenty-six — so that check fired on every
      // selection naming a background agent and took the CHAT agents in the same
      // sweep down with it. `auto` on a branch touching both a chat directory and
      // an experiment directory produced no verdict of any kind, which is strictly
      // worse than the unwired state it replaced: that skipped the background agent
      // by name and still judged the chat half.
      //
      // It was also self-defeating as a guard. Throwing before `captureArm` means
      // `putManifest` never runs and the judging step then fails on a missing arm —
      // precisely the end state the check exists to avoid. Thrown from here, the
      // manifest is written, it says which agent was refused and why, and the money
      // is still unspent.
      if (why !== undefined) {
        throw new Error(
          `${agent.agentId} ${why}. Background already has its own reduced ` +
            'budget and this does not fit inside it: select fewer agents, ' +
            'or change config.background.',
        )
      }
      remaining.slots -= runs
    }
    return { ...list, cases }
  }
}

// WHAT THE ARM ACTUALLY CALLS, so that CI executes the wiring rather than
// only the helper.
//
// `sweep.eval.test.ts` is `describe.skipIf(!sweepRequested)` — dead text in
// CI — so while it built these arguments inline, reverting them to the chat
// budget left the whole suite green. That is the same gap that let a swapped
// bucket and a hardcoded agent id through twice before.
//
// Takes the config rather than the two numbers, so there is one place that
// knows the background budget comes from `config.background`.
export const armCaseLoader = (
  values: PlaceholderValues,
  budgetMs: number,
  config: JudgeConfig,
  admitted?: ReadonlySet<string>,
  refusedReasons?: ReadonlyMap<string, string>,
): ((agent: AgentEntry) => CaseList) =>
  caseLoaderFor(values, {
    budgetMs,
    attemptsPerCase: config.background.attemptsPerCase,
    maxCases: config.background.maxCases,
    maxInFlight: config.background.maxInFlight,
    ...(admitted !== undefined && { admitted }),
    ...(refusedReasons !== undefined && { refusedReasons }),
  })

// THE TWO THINGS AN ARM HANDS captureArm FROM ITS RESOLVED ENVIRONMENT, built
// in one place that CI executes.
//
// They lived inline in `sweep.eval.test.ts`, which is `describe.skipIf` and
// never runs in CI, and two mistakes there passed the whole suite: building
// the loader once PER AGENT, which gives every agent a fresh budget and
// undoes the spend-down; and leaving `config` off captureArm's deps, so
// attempts fall back to the default while the cap uses the resolved budget —
// two halves of one budget read from two places.
export const armDeps = (
  env: ArmEnv,
  config: JudgeConfig,
  // The sweep's resolved budget when there is one, so both arms spend the
  // same; this arm's own constant otherwise, which is a local run.
  budgetMs: number = env.armBudgetMs ?? ARM_BUDGET_MS,
): { config: JudgeConfig; loadCases: (agent: AgentEntry) => CaseList } => ({
  config,
  loadCases: armCaseLoader(
    env.fixtureValues,
    budgetMs,
    config,
    env.backgroundAdmitted,
    withChatRefusals(env, config).backgroundRefused,
  ),
})

// WHY ONE AGENT'S RUNS DO NOT FIT THE WAVE, or undefined when they do.
//
// The arm starts every admitted run at once and is done when the slowest one
// is, so an agent fits when each of its runs fits the arm on its own and
// there are slots left for all of them. Deliberately not a packing of short
// runs behind each other in one slot: that schedule is only as safe as its
// worst case, and a run that finishes early lets the next one start somewhere
// else and finish later than planned. One wave has no such case.
// Room inside the arm for what is not the run: staging the config, sending
// the message, reading the trace back and writing the record. A run allowed
// right up to the arm's budget would always overrun it by that much.
export const WAVE_MARGIN_MS = 5 * 60 * 1000

export const waveRefusal = (
  runs: number,
  runMs: number,
  slotsLeft: number,
  budgetMs: number,
  maxInFlight: number,
): string | undefined => {
  const minutes = (value: number): number => Math.ceil(value / 60_000)
  if (runMs + WAVE_MARGIN_MS > budgetMs) {
    return (
      `would take ${minutes(runMs)} minutes for a single run on the slower ` +
      `arm, which with ${minutes(WAVE_MARGIN_MS)} to stage and record it ` +
      `does not fit the arm's ${minutes(budgetMs)}`
    )
  }
  if (runs > slotsLeft) {
    return (
      `needs ${runs} runs in flight at once, and ${slotsLeft} of the arm's ` +
      `${maxInFlight} slots were left once the agents before it were admitted`
    )
  }
  return undefined
}

// THE DECISION BOTH ARMS OBEY: which selected background agents fit one arm,
// walked in the order the arms will walk them.
//
// `costOf` returns an agent's runs and the wall clock of one run on ONE arm,
// or a refusal. The caller takes the larger of the two arms' run times, so an
// agent is admitted only if it fits on whichever arm is slower — a branch
// that LOWERS a timeout would otherwise be admitted on the candidate's number
// and then overrun the base arm at the base's. An agent one arm cannot load
// at all is refused here, before anyone pays: a background agent new on the
// branch has no base to be compared against.
//
// `maxInFlight` says how the arms will walk. Given, both start every run at
// once and admission fills that many slots. Absent, the base arm predates
// that and walks one run after another, so admission falls back to spending
// the arm's wall clock down run by run, which the slower arm can honour.
export const admitBackground = (
  selected: readonly AgentEntry[],
  costOf: (
    agent: AgentEntry,
  ) =>
    | { runs: number; runMs: number; caseIds?: readonly string[] }
    | { refused: string },
  budgetMs: number,
  maxInFlight?: number,
): { admitted: string[]; refused: { agentId: string; reason: string }[] } => {
  const admitted: string[] = []
  const refused: { agentId: string; reason: string }[] = []
  let remainingMs = budgetMs
  let slotsLeft = maxInFlight ?? 0
  const takenCaseIds = new Set<string>()
  const minutes = (value: number): number => Math.ceil(value / 60_000)
  for (const agent of selected) {
    if (agent.shape !== 'background') continue
    const cost = costOf(agent)
    if ('refused' in cost) {
      refused.push({ agentId: agent.agentId, reason: cost.refused })
      continue
    }
    if (maxInFlight !== undefined) {
      const why = waveRefusal(
        cost.runs,
        cost.runMs,
        slotsLeft,
        budgetMs,
        maxInFlight,
      )
      if (why !== undefined) {
        refused.push({ agentId: agent.agentId, reason: why })
        continue
      }
      admitted.push(agent.agentId)
      slotsLeft -= cost.runs
      continue
    }
    // A base arm this old names a run without its agent, so two agents
    // sharing a case id would dispatch one run id twice and the platform
    // would drop the second. Refused rather than walked.
    const shared = (cost.caseIds ?? []).filter((id) => takenCaseIds.has(id))
    if (shared.length > 0) {
      refused.push({
        agentId: agent.agentId,
        reason:
          `shares case ids [${shared.join(', ')}] with an agent already ` +
          "admitted, and the base ref's run ids do not name the agent, so " +
          'one of the two would never be dispatched',
      })
      continue
    }
    const ms = cost.runs * cost.runMs
    if (ms > remainingMs) {
      refused.push({
        agentId: agent.agentId,
        reason:
          `would take ${minutes(ms)} minutes on the slower arm, walked one ` +
          `run after another as the base ref does, and ` +
          `${minutes(remainingMs)} of the arm's ${minutes(budgetMs)} were ` +
          'left once the agents before it were admitted',
      })
      continue
    }
    admitted.push(agent.agentId)
    remainingMs -= ms
    for (const id of cost.caseIds ?? []) takenCaseIds.add(id)
  }
  return { admitted, refused }
}

// What an arm's chat agents may spend between them: the whole arm less the
// room WAVE_MARGIN_MS leaves for booting the app and writing the manifest.
// Not shared with background, which runs alongside rather than after.
export const chatBudgetMs = (budgetMs: number): number =>
  budgetMs - WAVE_MARGIN_MS

// WHY ONE CHAT AGENT'S TURNS DO NOT FIT what the chat agents before it left,
// or undefined when they do.
export const chatRefusal = (
  turns: number,
  turnMs: number,
  msLeft: number,
  budgetMs: number,
): string | undefined => {
  const minutes = (value: number): number => Math.ceil(value / 60_000)
  if (turns * turnMs <= msLeft) return undefined
  return (
    `would take about ${minutes(turns * turnMs)} minutes for ${turns} chat ` +
    `turns at ${turnMs / 1000}s each, and ${minutes(msLeft)} ` +
    `of the arm's ${minutes(budgetMs)} were left for chat once the chat ` +
    'agents before it were admitted; select fewer agents'
  )
}

// THE CHAT AGENTS NEITHER ARM MAY WALK, decided once like admitBackground
// and in the order the arm walks them. A refused agent leaves its share to
// the ones after it, so one heavy agent does not take the rest down with it.
export const refuseChat = (
  selected: readonly AgentEntry[],
  turnsOf: (agent: AgentEntry) => number,
  budgetMs: number,
): { agentId: string; reason: string }[] => {
  const refused: { agentId: string; reason: string }[] = []
  let msLeft = chatBudgetMs(budgetMs)
  for (const agent of selected) {
    if (agent.shape !== 'chat' || agent.cases === null) continue
    const turns = turnsOf(agent)
    const turnMs = chatTurnMsFor(agent.agentId)
    const why = chatRefusal(turns, turnMs, msLeft, budgetMs)
    if (why !== undefined) {
      refused.push({ agentId: agent.agentId, reason: why })
      continue
    }
    msLeft -= turns * turnMs
  }
  return refused
}

// How many turns a chat list drives per attempt: a case of several turns
// costs all of them.
export const chatTurnsIn = (list: CaseList): number =>
  list.cases.reduce(
    (sum, one) => sum + (isChatCase(one) ? caseTurns(one).length : 0),
    0,
  )

// THE CHAT REFUSALS AN ARM OBEYS. A sweep's come from the resolver and are
// returned as they are. A local run has no resolver, so it works its own out
// here, once, by the same rule — and both the loader and the arm suite's
// final check read the result, so a refusal is a refusal by design rather
// than a capture that failed and turned the run red.
//
// A list this tree cannot read counts no turns: the arm reports the real
// error by name.
export const withChatRefusals = (
  env: ArmEnv,
  config: JudgeConfig,
  find: (agentId: string) => AgentEntry | undefined = findAgent,
  load: (agent: AgentEntry) => CaseList = loadCaseList,
): ArmEnv => {
  if (env.backgroundRefused !== undefined) return env
  const selected = [...new Set(env.agentIds)]
    .map(find)
    .filter(
      (agent): agent is AgentEntry =>
        agent !== undefined && agent.status !== 'blocked',
    )
  const turnsOf = (agent: AgentEntry): number => {
    try {
      return chatTurnsIn(load(agent))
    } catch {
      return 0
    }
  }
  const refused = refuseChat(
    selected,
    (agent) => turnsOf(agent) * config.attemptsPerCase,
    env.armBudgetMs ?? ARM_BUDGET_MS,
  )
  return {
    ...env,
    backgroundRefused: new Map(refused.map((one) => [one.agentId, one.reason])),
  }
}

import { z } from 'zod'
import type { AgentEntry } from '../agents'
import type { JudgeConfig } from '../config'
import type { PlaceholderValues } from '../caseParams'
import { substituteBackgroundCases } from '../caseParams'
import type { CaseList } from '../cases'
import { isChatCase, loadBackgroundCases, loadCaseList } from '../cases'
import type { ArmCaseRequest } from '../sweepArm'
import type { ArmEnv } from '../sweepEnv'
import { backgroundDestinationFrom } from '../sweepEnv'
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
// ONE KNOWN GAP, not measured yet: only background wall clock is spent
// against this. Chat agents run inside the same arm and the same vitest
// timeout, and nothing deducts them, so a sweep heavy on chat cases plus a
// background agent that fits on its own could still overrun. There are no
// measured chat turn durations to budget them with; when there are, they
// belong in admitBackground's remaining budget.
export const ARM_BUDGET_MS = 70 * 60 * 1000

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
  const orgSlug = env.fixtureValues.orgSlug
  // Refused by name BEFORE anything is staged or sent. The dispatch builder
  // enforces the `judge-` prefix itself, but its message is about a slug it
  // was handed; this one is about the sweep not having minted a fixture, which
  // is the actual fault and names the variable that fixes it.
  if (orgSlug === undefined) {
    throw new Error(
      `${request.agent.agentId} is a background agent and this sweep minted ` +
        'no dev organization, so there is no judge- slug to dispatch ' +
        'against; see sweepFixture.ts and JUDGE_FIXTURE_ORG_SLUG',
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
    organizationSlug: orgSlug,
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
  const { budgetMs, attemptsPerCase, maxCases, admitted, refusedReasons } =
    budget
  if (maxCases !== undefined && maxCases < 1) {
    throw new Error(
      `the background case cap is ${maxCases}, which is not a number of ` +
        'cases a sweep can walk: 0 judges nothing while reporting a clean ' +
        'arm, and a negative one is read by slice as "all but the last" — ' +
        'nearly the whole list, which is the opposite of a cap',
    )
  }
  // SPENT DOWN ACROSS AGENTS, not re-offered to each one, and created ONCE
  // PER LOADER — so once per arm, since the arm builds one. captureArm walks
  // agents sequentially inside a single job, so a per-agent check against the
  // whole budget says yes to four agents that each fit and together take
  // three times the arm; the arm is then killed mid-walk, and because
  // putManifest runs after the loop, judging dies on a missing arm.
  const remaining = { ms: budgetMs }
  return (agent) => {
    const list = load(agent)
    if (list.shape !== 'background') return list
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
      values,
    )
    const config = loadConfig(agent.agentId)
    if (admitted === undefined) {
      // Refused BEFORE deducting, so a refused agent leaves its share for
      // the ones after it.
      refuseIfOverBudget(
        agent.agentId,
        cases.length,
        attemptsPerCase,
        config,
        remaining.ms,
        budgetMs,
      )
      remaining.ms -= armWallClockMs(cases.length, attemptsPerCase, config)
    }
    // Reached here rather than at the dispatch, where a manifest naming no
    // model would arrive as a skip on case 1 with every agent walked before
    // it already billed.
    modelOf(config)
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
    env.backgroundRefused,
  ),
})

// THE DECISION BOTH ARMS OBEY: which selected background agents fit one arm,
// walked in the order the arms will walk them.
//
// `costOf` returns an agent's wall clock on ONE arm, or a refusal. The caller
// takes the larger of the two arms' costs, so an agent is admitted only if it
// fits on whichever arm is slower — a branch that LOWERS a timeout would
// otherwise be admitted on the candidate's number and then overrun the base
// arm at the base's. An agent one arm cannot load at all is refused here,
// before anyone pays: a background agent new on the branch has no base to be
// compared against.
export const admitBackground = (
  selected: readonly AgentEntry[],
  costOf: (agent: AgentEntry) => { ms: number } | { refused: string },
  budgetMs: number,
): { admitted: string[]; refused: { agentId: string; reason: string }[] } => {
  const admitted: string[] = []
  const refused: { agentId: string; reason: string }[] = []
  let remaining = budgetMs
  const minutes = (value: number): number => Math.ceil(value / 60_000)
  for (const agent of selected) {
    if (agent.shape !== 'background') continue
    const cost = costOf(agent)
    if ('refused' in cost) {
      refused.push({ agentId: agent.agentId, reason: cost.refused })
      continue
    }
    if (cost.ms > remaining) {
      refused.push({
        agentId: agent.agentId,
        reason:
          `would take ${minutes(cost.ms)} minutes on the slower arm, and ` +
          `${minutes(remaining)} of the arm's ${minutes(budgetMs)} were ` +
          'left once the agents before it were admitted',
      })
      continue
    }
    admitted.push(agent.agentId)
    remaining -= cost.ms
  }
  return { admitted, refused }
}

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
// Exported so the real registry can be measured against a real budget in a
// unit test, rather than the arithmetic only ever being exercised against
// injected case counts and injected manifests. See budgetConsequences.test.ts,
// which pins which published agents fit an arm at today's budget.
export const armWallClockMs = (
  caseCount: number,
  attemptsPerCase: number,
  config: AgentConfig,
): number => caseCount * attemptsPerCase * pollTimeoutMs(config)

const refuseIfOverBudget = (
  agentId: string,
  caseCount: number,
  attemptsPerCase: number,
  config: AgentConfig,
  remainingMs: number,
  budgetMs: number,
): void => {
  const ms = armWallClockMs(caseCount, attemptsPerCase, config)
  if (ms <= remainingMs) return
  const minutes = (value: number): number => Math.ceil(value / 60_000)
  const spent = minutes(budgetMs - remainingMs)
  throw new Error(
    `${agentId} would take ${minutes(ms)} minutes of wall clock ` +
      `(${caseCount} cases x ${attemptsPerCase} attempts, each waiting out ` +
      `the agent's declared timeout), and this arm has ` +
      `${minutes(remainingMs)} of its ${minutes(budgetMs)} left` +
      (spent > 0 ? ` after ${spent} already committed to earlier agents` : '') +
      '. Cases run one after another, so the arm would be cut off partway ' +
      'with its records orphaned and no manifest written. Background already ' +
      'has its own reduced budget and this does not fit inside it: select ' +
      'fewer agents, or lower config.background.',
  )
}

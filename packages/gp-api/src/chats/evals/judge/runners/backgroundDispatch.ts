import { z } from 'zod'
import type { AgentEntry } from '../agents'
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
  return timeout_seconds * 1000 + POLL_HEADROOM_MS
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
export const caseLoaderFor =
  (
    values: PlaceholderValues,
    budgetMs: number,
    attemptsPerCase: number,
    load: typeof loadCaseList = loadCaseList,
    loadBackground: typeof loadBackgroundCases = loadBackgroundCases,
    loadConfig: (agentId: string) => AgentConfig = agentConfigFor,
  ) =>
  (agent: AgentEntry): CaseList => {
    const list = load(agent)
    if (list.shape !== 'background') return list
    // Re-read, once per agent rather than once per case, to get the loader's
    // own narrowing instead of a fourth structural one.
    const cases = substituteBackgroundCases(loadBackground(agent), values)
    const config = loadConfig(agent.agentId)
    refuseIfOverBudget(
      agent.agentId,
      cases.length,
      attemptsPerCase,
      config,
      budgetMs,
    )
    // Reached here rather than at the dispatch, where a manifest naming no
    // model would arrive as a skip on case 1 with every agent walked before
    // it already billed.
    modelOf(config)
    return { ...list, cases }
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
// injected case counts and injected manifests. See backgroundBudget.test.ts:
// at today's case lists and attempts, the answer for every published agent is
// "does not fit", and that belongs in CI rather than in a sweep's logs.
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
  budgetMs: number,
): void => {
  const ms = armWallClockMs(caseCount, attemptsPerCase, config)
  if (ms <= budgetMs) return
  const minutes = (value: number): number => Math.ceil(value / 60_000)
  throw new Error(
    `${agentId} would take ${minutes(ms)} minutes of wall clock on this ` +
      `arm (${caseCount} cases x ${attemptsPerCase} attempts, each waiting ` +
      `out the agent's declared timeout), against a budget of ` +
      `${minutes(budgetMs)}. Cases run one after another, so the arm would ` +
      'be cut off partway with its records orphaned. Background needs its ' +
      'own case and attempt budget before it can sweep.',
  )
}

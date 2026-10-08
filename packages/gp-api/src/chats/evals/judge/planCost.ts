import { z } from 'zod'
import type { AgentEntry } from './agents'
import { CaseListError, loadCaseList } from './cases'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { chatTurnsIn } from './runners/backgroundDispatch'

// WHAT A SWEEP WILL COST, per agent, priced before anything is spent. The
// workflow's estimate step sums the cents the plan prints and posts the total
// on the PR; it does no arithmetic of its own, so every number here is
// testable.
//
// The estimate is a warning, not a bill. It rounds up wherever it has to
// choose, because a low number is the one that lets an accidental `all`
// through unread.

// WHAT ONE BACKGROUND RUN COST IN A JUDGE SWEEP, per agent, measured. The same
// shape as CHAT_TURN_MS in runners/backgroundDispatch.ts: a checked-in table
// of what was observed, with a pessimistic default for anything not on it.
//
// Judge runs, not production runs. The fixtures are smaller than a real
// organization's data, so a judge run of meeting_briefing is about $1 where
// production's is about $7.74, and pricing every agent at production's worst
// case put ~$48 on a sweep that cost ~$8.
//
// Each figure is the mean per run on the report's `- cost difference per
// run pair:` line for that agent: the mean cost of one run on each arm, re-derived from token counts at the pricing
// version the report names. Read from the sweep job's log, not remembered.
export interface MeasuredRunCost {
  runUrl: string
  date: string
  baseUsd: number
  candidateUsd: number
  // Run pairs behind the means. Three is a thin sample; see the margin.
  pairs: number
}

export const MEASURED_BACKGROUND_RUN_COST: Readonly<
  Partial<Record<string, MeasuredRunCost>>
> = {
  meeting_briefing: {
    runUrl: 'https://github.com/thegoodparty/omni/actions/runs/37380629467',
    date: '2026-10-05',
    baseUsd: 1.0396,
    candidateUsd: 0.9169,
    pairs: 3,
  },
  opposition_research: {
    runUrl: 'https://github.com/thegoodparty/omni/actions/runs/37161231631',
    date: '2026-10-03',
    baseUsd: 0.1865,
    candidateUsd: 0.181,
    pairs: 3,
  },
  race_opponent_summary: {
    runUrl: 'https://github.com/thegoodparty/omni/actions/runs/37380598839',
    date: '2026-10-05',
    baseUsd: 0.4753,
    candidateUsd: 0.4197,
    pairs: 9,
  },
  top_community_issues: {
    runUrl: 'https://github.com/thegoodparty/omni/actions/runs/37380629467',
    date: '2026-10-05',
    baseUsd: 0.978,
    candidateUsd: 1.0904,
    pairs: 3,
  },
  trending_issues: {
    runUrl: 'https://github.com/thegoodparty/omni/actions/runs/37380629467',
    date: '2026-10-05',
    baseUsd: 0.9623,
    candidateUsd: 0.8179,
    pairs: 3,
  },
}

// WHAT ONE CHAT TURN COST IN A JUDGE SWEEP. The report's per-run mean is
// per case attempt, and every chat case list today is one turn a case, so
// that is a turn. chief_of_staff's three live sweeps measured $0.112 to
// $0.124; the latest, the one that wired it, is the entry.
export const MEASURED_CHAT_TURN_COST: Readonly<
  Partial<Record<string, MeasuredRunCost>>
> = {
  chief_of_staff: {
    runUrl: 'https://github.com/thegoodparty/omni/actions/runs/36999748321',
    date: '2026-10-02',
    baseUsd: 0.1221,
    candidateUsd: 0.123,
    pairs: 24,
  },
}

// An agent nobody has measured in a judge sweep is priced at production's
// worst measured mean per run, rounded up: meeting_briefing's ~$7.74,
// invoice-confirmed (.claude/skills/analyze-cap-agent-costs/profiles/
// meeting_briefing.md). Deliberately high, and the plan says "unmeasured" next
// to it so nobody mistakes it for a measurement.
export const UNMEASURED_BACKGROUND_RUN_CENTS = 800

// The most expensive chat turn on record, ordinance_flow's logged $0.5195 (see
// the sonnet rates in pricing.ts). No chat agent but chief_of_staff has been
// measured in a sweep, and priority_flow runs up to 30 tool steps a turn, so
// the costliest turn seen is the floor for guessing, not the cheapest.
export const UNMEASURED_CHAT_TURN_USD = 0.52

// THE MARGIN: times 1.5, then rounded up to the next $0.50. On a background
// agent it is applied to one run, from the larger of the two arms' means; on a
// chat agent to the whole sweep, because a turn is cents and rounding each one
// to $0.50 would multiply the estimate rather than pad it.
//
// x1.5 because most entries are a mean of three runs, and one run of an agent
// that researches the live web can cost well over its mean; a candidate that
// changes the agent can also move its cost, which the base arm's figure
// cannot know. The rounding is so the number reads as an estimate rather than
// a measurement to four places.
export const MEASURED_MARGIN = 1.5
export const ROUND_UP_TO_CENTS = 50

const withMargin = (usd: number): number =>
  Math.ceil((usd * MEASURED_MARGIN * 100) / ROUND_UP_TO_CENTS) *
  ROUND_UP_TO_CENTS

type CostTable = Readonly<Partial<Record<string, MeasuredRunCost>>>

const larger = (one: MeasuredRunCost): number =>
  Math.max(one.baseUsd, one.candidateUsd)

export const backgroundRunCents = (
  agentId: string,
  measured: CostTable = MEASURED_BACKGROUND_RUN_COST,
): { cents: number; measured: MeasuredRunCost | undefined } => {
  const one = measured[agentId]
  return one === undefined
    ? { cents: UNMEASURED_BACKGROUND_RUN_CENTS, measured: undefined }
    : { cents: withMargin(larger(one)), measured: one }
}

// The base-arm cache is not read by the sweep yet, so both arms run.
export const ARMS = 2

// Machine-read by the workflow: one lowercase token, no spaces.
export const CostBasisSchema = z.enum([
  'measured',
  'unmeasured',
  'no-case-list',
  'unreadable',
  // The base ref's prices could not be computed, so this agent is priced as
  // though nothing were measured. See priceAgainstReferences.
  'base-unread',
])
export type CostBasis = z.infer<typeof CostBasisSchema>

export const AgentEstimateSchema = z.object({
  cents: z.number().int().nonnegative(),
  basis: CostBasisSchema,
  // For a person reading the plan: how the number was arrived at.
  why: z.string(),
})
export type AgentEstimate = z.infer<typeof AgentEstimateSchema>

const dollars = (cents: number): string =>
  `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`

const plural = (count: number, one: string): string =>
  `${count} ${one}${count === 1 ? '' : 's'}`

export interface EstimateSources {
  countCases: (agent: AgentEntry) => number
  // Control cases (`scored: false`) past the cap, which both arms also walk
  // when both lists hold them out. Counted from this branch's list alone, so
  // the price is an upper bound: the base list can only lower it.
  countControlsPastCap: (
    agent: AgentEntry,
    maxCases: number | undefined,
  ) => number
  countTurns: (agent: AgentEntry) => number
  // The turns the BASE arm walks for a chat agent, from the base ref's own
  // list. Undefined when there is none, and this branch's count stands for
  // it, as armBudget.ts plans.
  baseTurns: (agent: AgentEntry) => number | undefined
  background: CostTable
  chat: CostTable
}

export const DEFAULT_SOURCES: EstimateSources = {
  countCases: (agent) => loadCaseList(agent).cases.length,
  countControlsPastCap: (agent, maxCases) =>
    maxCases === undefined
      ? 0
      : loadCaseList(agent)
          .cases.slice(maxCases)
          .filter((one) => 'scored' in one && one.scored === false).length,
  countTurns: (agent) => chatTurnsIn(loadCaseList(agent)),
  baseTurns: () => undefined,
  background: MEASURED_BACKGROUND_RUN_COST,
  chat: MEASURED_CHAT_TURN_COST,
}

// THE PARAMETERS ARE A CONTRACT WITH THE WORKFLOW. The estimate step loads
// the base ref's and the default branch's copies of this file and calls
// their estimateAgent with (agent, config, sources), so a PR cannot lower its
// own price by editing the tables here. Keep the defaults, and read only the
// `sources` keys a copy knows.
export const estimateAgent = (
  agent: AgentEntry,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
  sources: Partial<EstimateSources> = {},
): AgentEstimate => {
  const from = { ...DEFAULT_SOURCES, ...sources }
  if (agent.cases === null) {
    return {
      cents: 0,
      basis: 'no-case-list',
      why: 'no case list, so nothing is run',
    }
  }
  // An unreadable list is never run: admission refuses a background agent
  // whose list this branch cannot read, and a chat arm fails it by name
  // before its first turn. The case-list tests fail the PR that broke it.
  let listed: number
  try {
    listed =
      agent.shape === 'chat' ? from.countTurns(agent) : from.countCases(agent)
  } catch (err) {
    if (!(err instanceof CaseListError)) throw err
    return {
      cents: 0,
      basis: 'unreadable',
      why: 'its case list cannot be read, so nothing is run',
    }
  }
  // EACH ARM WALKS ITS OWN LIST, so a branch that trims a list still pays
  // for the base arm's longer one.
  if (agent.shape === 'chat') {
    const onBase = from.baseTurns(agent) ?? listed
    const attempts = config.attemptsPerCase
    const one = from.chat[agent.agentId]
    const perTurn = one === undefined ? UNMEASURED_CHAT_TURN_USD : larger(one)
    const cents = withMargin((onBase + listed) * attempts * perTurn)
    const source =
      one === undefined
        ? 'unmeasured, so priced at the costliest chat turn on record'
        : `measured in ${one.runUrl}`
    return {
      cents,
      basis: one === undefined ? 'unmeasured' : 'measured',
      why:
        `~${dollars(cents)} = (${onBase} base + ${listed} candidate turns) x ` +
        `${plural(attempts, 'attempt')} x $${perTurn.toFixed(4)} a turn, ` +
        `x${MEASURED_MARGIN} and rounded up (${source})`,
    }
  }
  const { maxCases, attemptsPerCase } = config.background
  const capped = Math.min(listed, maxCases ?? listed)
  const controls = from.countControlsPastCap(agent, maxCases)
  const cases = capped + controls
  const run = backgroundRunCents(agent.agentId, from.background)
  const cents = ARMS * cases * attemptsPerCase * run.cents
  const source =
    run.measured === undefined
      ? 'unmeasured, so priced at the production worst case'
      : `measured ${dollars(Math.round(larger(run.measured) * 100))} a run ` +
        `in ${run.measured.runUrl}, x${MEASURED_MARGIN} and rounded up`
  return {
    cents,
    basis: run.measured === undefined ? 'unmeasured' : 'measured',
    why:
      `~${dollars(cents)} = ${ARMS} arms x ${capped} of ` +
      `${plural(listed, 'case')}` +
      (controls === 0 ? '' : ` + ${plural(controls, 'control')}`) +
      ` x ${plural(attemptsPerCase, 'attempt')} x ` +
      `${dollars(run.cents)} a run (${source})`,
  }
}

export type EstimateFn = (
  agent: AgentEntry,
  config: JudgeConfig,
  sources: Partial<EstimateSources>,
) => AgentEstimate

// One ref this branch is priced against: the PR's base ref, and the
// repository's default branch, so a PR opened against a branch that carries
// a cheap table is still priced at the default branch's. Undefined where it
// could not be read.
export interface Reference {
  estimate: EstimateFn | undefined
  chatAttempts: number | undefined
  // The ref's list for a chat agent was fetched and could not be read.
  chatTurns?: (agent: AgentEntry) => number | 'absent' | 'unread'
}

// THE HIGHEST OF THIS BRANCH'S PRICE AND EVERY REFERENCE'S, per agent, all
// computed over this branch's case lists and config — what the arms will
// actually walk. A PR that edits the tables above can raise its own estimate
// and never lower it.
//
// FAILS CLOSED. When any reference's prices cannot be computed (its copy is
// missing, will not load or throws), or a chat agent's attempts or list
// cannot be read from a reference, the agent is priced as though nothing were
// measured: the worst case, labelled so. The candidate's own figure alone
// would be the self-serving number this exists to stop.
//
// What it does not stop is a PR that edits this function or the CLI. The
// number is a warning on the PR, and that change is in the diff under review.
export const priceAgainstReferences = (
  references: readonly Reference[],
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
  sources: Partial<EstimateSources> = {},
  candidate: EstimateFn = estimateAgent,
): ((agent: AgentEntry) => AgentEstimate) => {
  return (agent) => {
    const ours = candidate(agent, config, sources)
    if (ours.cents === 0) return ours
    let best = ours
    let unread = false
    for (const reference of references) {
      let theirs: AgentEstimate | undefined
      try {
        theirs =
          reference.estimate === undefined ||
          (agent.shape === 'chat' &&
            (reference.chatAttempts === undefined ||
              reference.chatTurns?.(agent) === 'unread'))
            ? undefined
            : AgentEstimateSchema.parse(
                reference.estimate(agent, config, sources),
              )
      } catch {
        theirs = undefined
      }
      if (theirs === undefined) unread = true
      else if (theirs.cents > best.cents) {
        best = {
          ...theirs,
          why: `${theirs.why}; a reference ref's price, above this branch's ${dollars(ours.cents)}`,
        }
      }
    }
    if (!unread) return best
    const worst = estimateAgent(agent, config, {
      ...sources,
      background: {},
      chat: {},
    })
    if (best.cents > worst.cents) return best
    return {
      ...worst,
      basis: 'base-unread',
      why:
        `${worst.why}; a reference ref's prices could not be computed, so ` +
        'nothing measured is trusted',
    }
  }
}

// The base ref's chat attempts per case, read from its config.ts. The
// top-level key is the only one at two spaces of indent; background's sits
// inside its own object.
export const BASE_CHAT_ATTEMPTS = /^ {2}attemptsPerCase: (\d+),(?:\s*\/\/.*)?$/m

export const baseChatAttemptsIn = (configText: string): number | undefined => {
  const found = BASE_CHAT_ATTEMPTS.exec(configText)?.[1]
  return found === undefined ? undefined : Number(found)
}

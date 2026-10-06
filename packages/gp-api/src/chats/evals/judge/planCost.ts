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
// Each figure is the report's own `- cost:` line for that agent: the mean
// cost of one run on each arm, re-derived from token counts at the pricing
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

// WHAT ONE CHAT TURN COST IN A JUDGE SWEEP. The report's `- cost:` line is
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
  // though nothing were measured. See priceAgainstBase.
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
  countTurns: (agent: AgentEntry) => number
  background: CostTable
  chat: CostTable
}

export const DEFAULT_SOURCES: EstimateSources = {
  countCases: (agent) => loadCaseList(agent).cases.length,
  countTurns: (agent) => chatTurnsIn(loadCaseList(agent)),
  background: MEASURED_BACKGROUND_RUN_COST,
  chat: MEASURED_CHAT_TURN_COST,
}

// THE FIRST TWO PARAMETERS ARE A CONTRACT WITH THE WORKFLOW. The estimate
// step loads the BASE ref's copy of this file and calls its estimateAgent
// with (agent, config) only, so a PR cannot lower its own price by editing
// the tables here. Anything after `config` must keep a default.
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
  if (agent.shape === 'chat') {
    const attempts = config.attemptsPerCase
    const one = from.chat[agent.agentId]
    const perTurn = one === undefined ? UNMEASURED_CHAT_TURN_USD : larger(one)
    const cents = withMargin(ARMS * listed * attempts * perTurn)
    const source =
      one === undefined
        ? 'unmeasured, so priced at the costliest chat turn on record'
        : `measured in ${one.runUrl}`
    return {
      cents,
      basis: one === undefined ? 'unmeasured' : 'measured',
      why:
        `~${dollars(cents)} = ${ARMS} arms x ${plural(listed, 'turn')} x ` +
        `${plural(attempts, 'attempt')} x $${perTurn.toFixed(4)} a turn, ` +
        `x${MEASURED_MARGIN} and rounded up (${source})`,
    }
  }
  const { maxCases, attemptsPerCase } = config.background
  const cases = Math.min(listed, maxCases ?? listed)
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
      `~${dollars(cents)} = ${ARMS} arms x ${cases} of ` +
      `${plural(listed, 'case')} x ${plural(attemptsPerCase, 'attempt')} x ` +
      `${dollars(run.cents)} a run (${source})`,
  }
}

export type EstimateFn = (
  agent: AgentEntry,
  config: JudgeConfig,
) => AgentEstimate

// THE HIGHER OF THIS BRANCH'S PRICE AND THE BASE REF'S, per agent, both
// computed over this branch's case lists and config — what the arms will
// actually walk. A PR that edits the tables above can raise its own estimate
// and never lower it.
//
// FAILS CLOSED. With no base pricing to compare against (the base ref
// predates this file, or its copy will not load or throws), the agent is
// priced as though nothing were measured: the worst case, labelled so. The
// candidate's own figure alone would be the self-serving number this exists
// to stop.
//
// What it does not stop is a PR that edits this function or the CLI. The
// number is a warning on the PR, and that change is in the diff under review.
export const priceAgainstBase = (
  base: EstimateFn | undefined,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
  candidate: EstimateFn = estimateAgent,
): ((agent: AgentEntry) => AgentEstimate) => {
  return (agent) => {
    const ours = candidate(agent, config)
    let theirs: AgentEstimate | undefined
    try {
      theirs =
        base === undefined
          ? undefined
          : AgentEstimateSchema.parse(base(agent, config))
    } catch {
      theirs = undefined
    }
    if (theirs === undefined) {
      if (ours.cents === 0) return ours
      const worst = estimateAgent(agent, config, { background: {}, chat: {} })
      return {
        ...worst,
        basis: 'base-unread',
        why:
          `${worst.why}; the base ref's prices could not be computed, so ` +
          'nothing measured is trusted',
      }
    }
    return theirs.cents > ours.cents
      ? {
          ...theirs,
          why: `${theirs.why}; the base ref's price, above this branch's ${dollars(ours.cents)}`,
        }
      : ours
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

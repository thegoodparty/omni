import type { AgentEntry } from './agents'
import { CaseListError, loadCaseList } from './cases'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'

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

// An agent nobody has measured in a judge sweep is priced at production's
// worst measured mean per run, rounded up: meeting_briefing's ~$7.74,
// invoice-confirmed (.claude/skills/analyze-cap-agent-costs/profiles/
// meeting_briefing.md). Deliberately high, and the plan says "unmeasured" next
// to it so nobody mistakes it for a measurement.
export const UNMEASURED_BACKGROUND_RUN_CENTS = 800

// THE MARGIN ON A MEASUREMENT: the larger of the two arms' means, times 1.5,
// then rounded up to the next $0.50.
//
// x1.5 because most entries are a mean of three runs, and one run of an agent
// that researches the live web can cost well over its mean; a candidate that
// changes the agent can also move its cost, which the base arm's figure
// cannot know. The rounding is so the number reads as an estimate rather than
// a measurement to four places.
export const MEASURED_MARGIN = 1.5
export const ROUND_UP_TO_CENTS = 50

export const backgroundRunCents = (
  agentId: string,
  measured: Readonly<
    Partial<Record<string, MeasuredRunCost>>
  > = MEASURED_BACKGROUND_RUN_COST,
): { cents: number; measured: MeasuredRunCost | undefined } => {
  const one = measured[agentId]
  if (one === undefined) {
    return { cents: UNMEASURED_BACKGROUND_RUN_CENTS, measured: undefined }
  }
  const withMargin =
    Math.max(one.baseUsd, one.candidateUsd) * MEASURED_MARGIN * 100
  return {
    cents: Math.ceil(withMargin / ROUND_UP_TO_CENTS) * ROUND_UP_TO_CENTS,
    measured: one,
  }
}

// A CHAT AGENT'S WHOLE SWEEP, from the design doc's measured sweep costs: ~$7
// an agent, and ordinance_flow at five times that because each of its steps
// costs five times any other chat agent's. Not modelled per turn, because a
// chat sweep's turns, attempts and judging were measured together.
//
// Still a safe ceiling at today's budget: chief_of_staff's measured $0.097 a
// turn over 2 arms x 8 cases x 3 attempts is about $4.66 before judging.
export const CHAT_AGENT_SWEEP_CENTS = 700
export const CHAT_SWEEP_MULTIPLE: Readonly<Partial<Record<string, number>>> = {
  ordinance_flow: 5,
}

// The base-arm cache is not read by the sweep yet, so both arms run.
export const ARMS = 2

// Machine-read by the workflow: one lowercase token, no spaces.
export type CostBasis =
  | 'measured'
  | 'unmeasured'
  | 'design-doc'
  | 'no-case-list'
  | 'unreadable'

export interface AgentEstimate {
  cents: number
  basis: CostBasis
  // For a person reading the plan: how the number was arrived at.
  why: string
}

const dollars = (cents: number): string =>
  `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`

const plural = (count: number, one: string): string =>
  `${count} ${one}${count === 1 ? '' : 's'}`

export const caseCountOf = (agent: AgentEntry): number =>
  loadCaseList(agent).cases.length

export const estimateAgent = (
  agent: AgentEntry,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
  countCases: (agent: AgentEntry) => number = caseCountOf,
  measured: Readonly<
    Partial<Record<string, MeasuredRunCost>>
  > = MEASURED_BACKGROUND_RUN_COST,
): AgentEstimate => {
  if (agent.cases === null) {
    return {
      cents: 0,
      basis: 'no-case-list',
      why: 'no case list, so nothing is run',
    }
  }
  if (agent.shape === 'chat') {
    const multiple = CHAT_SWEEP_MULTIPLE[agent.agentId] ?? 1
    const cents = CHAT_AGENT_SWEEP_CENTS * multiple
    return {
      cents,
      basis: 'design-doc',
      why:
        `~${dollars(cents)}, the design doc's measured chat sweep` +
        (multiple === 1 ? '' : ` at ${multiple}x for this agent's steps`),
    }
  }
  // Admission refuses an agent whose list this branch cannot read, on both
  // arms, so it is never run and costs nothing. The case-list tests fail the
  // PR that broke it.
  let listed: number
  try {
    listed = countCases(agent)
  } catch (err) {
    if (!(err instanceof CaseListError)) throw err
    return {
      cents: 0,
      basis: 'unreadable',
      why: 'its case list cannot be read, so admission refuses it and nothing is run',
    }
  }
  const { maxCases, attemptsPerCase } = config.background
  const cases = Math.min(listed, maxCases ?? listed)
  const run = backgroundRunCents(agent.agentId, measured)
  const cents = ARMS * cases * attemptsPerCase * run.cents
  const source =
    run.measured === undefined
      ? 'unmeasured, so priced at the production worst case'
      : `measured ${dollars(
          Math.round(
            Math.max(run.measured.baseUsd, run.measured.candidateUsd) * 100,
          ),
        )} a run in ${run.measured.runUrl}, x${MEASURED_MARGIN} and rounded up`
  return {
    cents,
    basis: run.measured === undefined ? 'unmeasured' : 'measured',
    why:
      `~${dollars(cents)} = ${ARMS} arms x ${cases} of ${plural(listed, 'case')}` +
      ` x ${plural(attemptsPerCase, 'attempt')} x ${dollars(run.cents)} a run` +
      ` (${source})`,
  }
}

import type { JsonJudgeModel } from '../../general/ordinance-flow/evals/coldJudge'
import type { LlmJsonCompletionOptions } from '../../../llm/services/llm.service'
import { priceUsd, UnpriceableRunError } from './pricing'
import type { RunRecord } from './record'

// WHAT THIS SWEEP SPENT, as opposed to what the plan estimated and as opposed
// to the per-pair cost DIFFERENCE beside each verdict. The report printed the
// estimate in three places and the actual bill nowhere, so a reader had no way
// to tell whether ~$48 estimated was $48 spent or $2.
//
// Totals only, in dollars. omni is public and this lands in a job summary, so
// nothing here carries a record's text, a case id or a tool name.

// Why a run has no figure. A closed set, because each one becomes a fixed
// sentence in a public summary and nothing from the record reaches it.
//
//   noCostRecorded  no stored cost: what a background run cancelled at its
//                   own timeout leaves behind, and a chat run whose usage
//                   gp-api did not report.
//   unpricedModel   tokens, but on a model pricing.ts has no rates for: a
//                   chat turn that fell back to a model nobody priced.
export type UnmeasuredReason = 'noCostRecorded' | 'unpricedModel'

// One arm's agent spend. Unmeasured runs are counted rather than priced at
// zero, so the total can say it is a lower bound and why.
export interface ArmSpend {
  usd: number
  runs: number
  unmeasured: Readonly<Record<UnmeasuredReason, number>>
}

export interface JudgeSpend {
  usd: number
  calls: number
  // Calls that threw. The LLM client reports usage only on success, so a
  // failed call's tokens are spent and invisible.
  failedCalls: number
  // A call that returned with no usage to price.
  unmeasured: number
}

export interface AgentSpend {
  agentId: string
  base: ArmSpend
  candidate: ArmSpend
  judge: JudgeSpend
}

export interface ActualCost {
  base: ArmSpend
  candidate: ArmSpend
  judge: JudgeSpend
  agents: readonly AgentSpend[]
  // Records for agents outside this sweep's selection. The arm totals above
  // include them, so without this row the agents' lines would not add up to
  // the total. Absent when there were none, which is every ordinary sweep.
  unselected?: Pick<AgentSpend, 'base' | 'candidate'>
  // The plan job's figure, as it printed it, so the two sit side by side.
  // Absent on a local run, which had no plan.
  estimateUsd?: string
}

export const NO_JUDGE_SPEND: JudgeSpend = {
  usd: 0,
  calls: 0,
  failedCalls: 0,
  unmeasured: 0,
}

// What one run cost, or null when nothing recorded it.
//
// The stored snapshot first, which is the opposite of the comparison layer's
// rule and deliberately so: comparison re-derives because a cached base arm
// may have been priced under an older table, but this is the bill for runs
// captured in THIS sweep, and `usdAtCapture` is the field that exists to say
// what a run cost at the time. It is also the only figure a background run
// has: the Fargate harness logs `total_cost_usd` and no token counts.
//
// A stored ZERO is not a price. A background run cancelled at its own timeout
// stores 0 with a trace note saying it is unmeasured (runners/background.ts
// `unmeasuredCost`), and no real model call is free, so 0 falls through to
// the tokens and then to a reason.
//
// An ABSENT cost is never priced from the tokens. A runner leaves it off when
// it would not stand behind a figure, so the tokens beside it are zero or
// partial, and pricing them prints a low total as if measured.
export const runCostUsd = (record: RunRecord): number | UnmeasuredReason => {
  const { cost, tokens } = record.telemetry
  if (cost !== undefined && cost.usdAtCapture > 0) return cost.usdAtCapture
  if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite === 0)
    return 'noCostRecorded'
  try {
    const usd = priceUsd(tokens, record.variant.model)
    return cost === undefined ? 'noCostRecorded' : usd
  } catch (err) {
    if (err instanceof UnpriceableRunError) return 'unpricedModel'
    throw err
  }
}

// EVERY RECORD, NOT ONLY THE JUDGEABLE PAIRS. A run excluded for a tool error
// or an infra error, or belonging to an agent the judge refused, was still
// dispatched and still billed. The base-arm cache is not read by the sweep
// yet (planCost.ts), so every record listed for a sweep was paid for in it.
// THE DAY IT IS, a base record reused from an earlier sweep is a cache hit
// and was billed to that sweep, not this one: it has to be skipped here or
// this total charges it twice.
export const armSpend = (
  records: readonly RunRecord[],
  arm: RunRecord['arm'],
): ArmSpend => {
  let usd = 0
  let runs = 0
  const unmeasured: Record<UnmeasuredReason, number> = {
    noCostRecorded: 0,
    unpricedModel: 0,
  }
  for (const record of records) {
    if (record.arm !== arm) continue
    runs += 1
    const cost = runCostUsd(record)
    if (typeof cost === 'number') usd += cost
    else unmeasured[cost] += 1
  }
  return { usd, runs, unmeasured }
}

type Usage = Omit<
  Awaited<ReturnType<JsonJudgeModel['jsonCompletion']>>,
  'object'
>

// Wraps the panel's client so every call it makes is priced, without the
// judge itself knowing. `snapshot` is read before and after an agent's
// judgments to attribute the panel's spend to that agent.
//
// One undercount it cannot see: a seat whose first attempt failed is retried
// INSIDE LlmService, and the client returns only the attempt that succeeded.
// The report says so on every sweep (see actualCostLines).
export const meterJudge = (
  llm: JsonJudgeModel,
): { llm: JsonJudgeModel; snapshot: () => JudgeSpend } => {
  const spend: JudgeSpend = { ...NO_JUDGE_SPEND }
  const record = (usage: Usage): void => {
    // A canned panel answers with no tokens at all, and costs nothing.
    if (usage.tokens === 0) return
    const { inputTokens, outputTokens } = usage
    if (inputTokens === undefined || outputTokens === undefined) {
      spend.unmeasured += 1
      return
    }
    try {
      spend.usd += priceUsd(
        {
          input: inputTokens,
          output: outputTokens,
          cacheRead: 0,
          cacheWrite: 0,
        },
        usage.model,
      )
    } catch (err) {
      if (!(err instanceof UnpriceableRunError)) throw err
      spend.unmeasured += 1
    }
  }
  const metered: JsonJudgeModel = {
    jsonCompletion: async <T>(options: LlmJsonCompletionOptions<T>) => {
      spend.calls += 1
      const result = await llm
        .jsonCompletion<T>(options)
        .catch((err: Error) => {
          spend.failedCalls += 1
          throw err
        })
      record(result)
      return result
    },
  }
  return { llm: metered, snapshot: () => ({ ...spend }) }
}

// The plan job's estimate, as its `usd` output prints it. Anything else is
// dropped rather than echoed: it reaches a public summary.
const ESTIMATE = /^\d{1,6}\.\d{2}$/
export const parseEstimateUsd = (
  value: string | undefined,
): string | undefined =>
  value !== undefined && ESTIMATE.test(value) ? value : undefined

const dollars = (usd: number): string => `$${usd.toFixed(2)}`

// The part of the report this file renders is the same for the sweep and for
// one agent, so both are this shape.
type Spend = Pick<ActualCost, 'base' | 'candidate' | 'judge'>

const unmeasuredRuns = (cost: Spend, reason: UnmeasuredReason): number =>
  cost.base.unmeasured[reason] + cost.candidate.unmeasured[reason]

const unmeasuredCount = (arm: ArmSpend): number =>
  arm.unmeasured.noCostRecorded + arm.unmeasured.unpricedModel

const isLowerBound = (cost: Spend): boolean =>
  unmeasuredCount(cost.base) > 0 ||
  unmeasuredCount(cost.candidate) > 0 ||
  cost.judge.failedCalls > 0 ||
  cost.judge.unmeasured > 0

export const totalUsd = (cost: Spend): number =>
  cost.base.usd + cost.candidate.usd + cost.judge.usd

// Also the value the workflow reads back for the closing summary table, so
// the two places say the same thing.
export const formatTotal = (cost: Spend): string =>
  `${isLowerBound(cost) ? 'at least ' : ''}${dollars(totalUsd(cost))}`

// Between two snapshots of the metered panel: what one agent's judgments
// cost.
export const judgeSpendBetween = (
  before: JudgeSpend,
  after: JudgeSpend,
): JudgeSpend => ({
  usd: after.usd - before.usd,
  calls: after.calls - before.calls,
  failedCalls: after.failedCalls - before.failedCalls,
  unmeasured: after.unmeasured - before.unmeasured,
})

const armCell = (arm: ArmSpend): string => {
  const unmeasured = unmeasuredCount(arm)
  return (
    `${dollars(arm.usd)} over ${arm.runs} run(s)` +
    (unmeasured > 0 ? `, ${unmeasured} unmeasured` : '')
  )
}

const UNMEASURED_REASON_TEXT: Readonly<Record<UnmeasuredReason, string>> = {
  noCostRecorded:
    'recorded no cost, which is what a background run cancelled at its own ' +
    'timeout, or a chat run whose usage gp-api did not report, looks like',
  unpricedModel: 'ran on a model pricing.ts has no rates for',
}

// Why a total is a lower bound, one clause per cause, so "at least" is never
// printed without a reason beside it.
const lowerBoundReasons = (cost: ActualCost): string[] => {
  const reasons: string[] = []
  for (const reason of ['noCostRecorded', 'unpricedModel'] as const) {
    const runs = unmeasuredRuns(cost, reason)
    if (runs > 0) {
      reasons.push(`${runs} agent run(s) ${UNMEASURED_REASON_TEXT[reason]}`)
    }
  }
  if (cost.judge.failedCalls > 0) {
    reasons.push(
      `${cost.judge.failedCalls} judge call(s) failed, and a failed call ` +
        'reports no usage',
    )
  }
  if (cost.judge.unmeasured > 0) {
    reasons.push(
      `${cost.judge.unmeasured} judge call(s) returned no usage this table ` +
        'can price',
    )
  }
  return reasons
}

export const actualCostLines = (cost: ActualCost): string[] => {
  const lines = [
    `**Actual cost: ${formatTotal(cost)}**` +
      (cost.estimateUsd === undefined
        ? ''
        : ` (estimated before the run: ~$${cost.estimateUsd})`),
    '',
    '| | spent |',
    '| --- | --- |',
    `| agent runs, base | ${armCell(cost.base)} |`,
    `| agent runs, candidate | ${armCell(cost.candidate)} |`,
    `| judge panel | ${dollars(cost.judge.usd)} over ${cost.judge.calls} call(s) |`,
  ]
  if (cost.unselected !== undefined) {
    const { base, candidate } = cost.unselected
    lines.push(
      `| of which, agents outside this sweep's selection | ` +
        `${dollars(base.usd + candidate.usd)} over ` +
        `${base.runs + candidate.runs} run(s) |`,
    )
  }
  const reasons = lowerBoundReasons(cost)
  if (reasons.length > 0) {
    lines.push('', `A lower bound: ${reasons.join('; ')}.`)
  }
  // ALWAYS, because nothing can detect it. LlmService retries a failed
  // attempt internally and reports only the one that succeeded, and so does
  // a chat turn's provider call, so a retried call is billed twice and
  // counted once.
  lines.push(
    '',
    'A model call that was retried counts once here, so this can run ' +
      'slightly low.',
  )
  return lines
}

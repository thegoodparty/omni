import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { JsonJudgeModel } from '../../general/ordinance-flow/evals/coldJudge'
import {
  actualCostLines,
  armSpend,
  formatTotal,
  meterJudge,
  NO_JUDGE_SPEND,
  parseEstimateUsd,
  runCostUsd,
  type ActualCost,
} from './actualCost'
import { CHAT_PAIR } from './fixtures/records'
import type { RunRecord } from './record'
import { renderReport } from './report'
import { emitActualCost } from './sweep'

const [BASE, CANDIDATE] = CHAT_PAIR

const withCost = (
  record: RunRecord,
  usd: number | undefined,
  tokens = record.telemetry.tokens,
): RunRecord => {
  const { cost, ...telemetry } = record.telemetry
  return {
    ...record,
    telemetry: {
      ...telemetry,
      tokens,
      ...(usd === undefined || cost === undefined
        ? {}
        : { cost: { ...cost, usdAtCapture: usd } }),
    },
  }
}

const NO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const NONE = { noCostRecorded: 0, unpricedModel: 0 }

describe('runCostUsd', () => {
  it('reads the stored snapshot, which is what the run cost', () => {
    expect(runCostUsd(withCost(BASE, 1.25))).toBe(1.25)
  })

  // A background run cancelled at its own timeout stores 0 beside a trace
  // note. Counting that as free would print a low total as if measured.
  it('treats a stored zero with no tokens as unmeasured, not free', () => {
    expect(runCostUsd(withCost(BASE, 0, NO_TOKENS))).toBe('noCostRecorded')
  })

  it('prices the tokens when nothing was stored', () => {
    // 31,213 input at $3/M plus 227 output at $15/M.
    expect(runCostUsd(withCost(BASE, undefined))).toBeCloseTo(0.097, 4)
  })

  it('is unmeasured for a model with no rates rather than throwing', () => {
    const unpriced = {
      ...withCost(BASE, undefined),
      variant: { ...BASE.variant, model: 'claude-opus-4-7' },
    }
    expect(runCostUsd(unpriced)).toBe('unpricedModel')
  })
})

describe('armSpend', () => {
  // An excluded pair was still billed. The total is what was spent, not
  // what was judged.
  it('counts every record on the arm, including an infra error', () => {
    const failed: RunRecord = {
      ...withCost(BASE, 0.5),
      runId: `${BASE.runId}-failed`,
      status: 'infraError',
      output: null,
    }
    const spend = armSpend(
      [withCost(BASE, 0.25), failed, withCost(CANDIDATE, 9)],
      'base',
    )
    expect(spend).toEqual({ usd: 0.75, runs: 2, unmeasured: NONE })
  })

  it('counts a run with no cost as unmeasured', () => {
    const spend = armSpend([withCost(BASE, 0, NO_TOKENS)], 'base')
    expect(spend).toEqual({
      usd: 0,
      runs: 1,
      unmeasured: { ...NONE, noCostRecorded: 1 },
    })
  })
})

const answering = (
  usage: Partial<
    Omit<Awaited<ReturnType<JsonJudgeModel['jsonCompletion']>>, 'object'>
  >,
): JsonJudgeModel => ({
  jsonCompletion: async ({ schema }) => ({
    object: schema.parse({}),
    tokens: 1_100,
    model: 'claude-sonnet-4-6',
    ...usage,
  }),
})

const options = { messages: [], schema: z.object({}) }

describe('meterJudge', () => {
  it('prices every call from its input and output tokens', async () => {
    const { llm, snapshot } = meterJudge(
      answering({ inputTokens: 1_000, outputTokens: 100 }),
    )
    await llm.jsonCompletion(options)
    await llm.jsonCompletion(options)
    // 1,000 at $3/M plus 100 at $15/M, twice.
    expect(snapshot().usd).toBeCloseTo(0.009, 6)
    expect(snapshot().calls).toBe(2)
  })

  it('counts a failed call and still throws it', async () => {
    const { llm, snapshot } = meterJudge({
      jsonCompletion: async () => {
        throw new Error('429')
      },
    })
    await expect(llm.jsonCompletion(options)).rejects.toThrow('429')
    expect(snapshot()).toEqual({ ...NO_JUDGE_SPEND, calls: 1, failedCalls: 1 })
  })

  it('counts a call with no usage split as unmeasured', async () => {
    const { llm, snapshot } = meterJudge(answering({}))
    await llm.jsonCompletion(options)
    expect(snapshot()).toEqual({ ...NO_JUDGE_SPEND, calls: 1, unmeasured: 1 })
  })

  // The canned panel answers with no tokens and costs nothing.
  it('treats a call that used no tokens as free', async () => {
    const { llm, snapshot } = meterJudge(
      answering({ tokens: 0, model: 'canned-judge' }),
    )
    await llm.jsonCompletion(options)
    expect(snapshot()).toEqual({ ...NO_JUDGE_SPEND, calls: 1 })
  })
})

const COST: ActualCost = {
  base: { usd: 1.5, runs: 3, unmeasured: NONE },
  candidate: { usd: 1.75, runs: 3, unmeasured: NONE },
  judge: { usd: 0.25, calls: 4, failedCalls: 0, unmeasured: 0 },
  agents: [],
  estimateUsd: '12.00',
}

describe('the actual cost block', () => {
  it('prints the total beside the estimate', () => {
    const lines = actualCostLines(COST)
    expect(lines[0]).toBe(
      '**Actual cost: $3.50** (estimated before the run: ~$12.00)',
    )
    expect(lines).toContain('| agent runs, base | $1.50 over 3 run(s) |')
    expect(lines).toContain('| judge panel | $0.25 over 4 call(s) |')
    expect(lines.join('\n')).not.toContain('lower bound')
  })

  it('says "at least" and why when a run went unmeasured', () => {
    const cost = {
      ...COST,
      candidate: {
        usd: 1.75,
        runs: 3,
        unmeasured: { noCostRecorded: 1, unpricedModel: 2 },
      },
      judge: { ...COST.judge, failedCalls: 2 },
    }
    expect(formatTotal(cost)).toBe('at least $3.50')
    const text = actualCostLines(cost).join('\n')
    expect(text).toContain('**Actual cost: at least $3.50**')
    expect(text).toContain('1 agent run(s) recorded no cost and no token')
    expect(text).toContain(
      '2 agent run(s) ran on a model pricing.ts has no rates for',
    )
    expect(text).toContain('2 judge call(s) failed')
  })

  // Nothing can detect a retry, so this is printed on every sweep rather
  // than only when something else made the total a lower bound.
  it('always says a retried call counts once', () => {
    expect(actualCostLines(COST)).toContain(
      'A model call that was retried counts once here, so this can run ' +
        'slightly low.',
    )
  })

  it('accounts for records outside the selection on their own row', () => {
    const cost = {
      ...COST,
      unselected: {
        base: { usd: 0.5, runs: 1, unmeasured: NONE },
        candidate: { usd: 0.25, runs: 1, unmeasured: NONE },
      },
    }
    expect(actualCostLines(cost)).toContain(
      "| of which, agents outside this sweep's selection | $0.75 over 2 " +
        'run(s) |',
    )
  })

  // One cause at a time, so no cause hides behind another.
  it.each([
    [
      'a base run with no cost',
      { base: { ...COST.base, unmeasured: { ...NONE, noCostRecorded: 1 } } },
    ],
    [
      'a candidate run on an unpriced model',
      {
        candidate: {
          ...COST.candidate,
          unmeasured: { ...NONE, unpricedModel: 1 },
        },
      },
    ],
    ['a failed judge call', { judge: { ...COST.judge, failedCalls: 1 } }],
    ['an unpriced judge call', { judge: { ...COST.judge, unmeasured: 1 } }],
  ])('is a lower bound after %s', (_, over) => {
    expect(formatTotal({ ...COST, ...over })).toBe('at least $3.50')
  })

  it('sits above every verdict in the report', () => {
    const report = renderReport({ agents: [], actualCost: COST })
    expect(report.indexOf('**Actual cost')).toBeLessThan(
      report.indexOf('No agent produced a verdict'),
    )
  })
})

describe('parseEstimateUsd', () => {
  it('keeps the plan job figure', () => {
    expect(parseEstimateUsd('681.00')).toBe('681.00')
  })

  // It reaches a public summary, so anything but a dollar figure is dropped.
  it.each([undefined, '', '12', '$12.00', '12.00 | x', '1e3'])(
    'drops %s',
    (value) => {
      expect(parseEstimateUsd(value)).toBeUndefined()
    },
  )
})

describe('emitActualCost', () => {
  it('hands the closing summary the same total the report printed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'judge-actual-'))
    const output = path.join(dir, 'output')
    emitActualCost({ agents: [], actualCost: COST }, { GITHUB_OUTPUT: output })
    expect(await readFile(output, 'utf8')).toBe('actual_usd=$3.50\n')
  })

  it('writes nothing for a sweep that could not spend', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'judge-actual-'))
    const output = path.join(dir, 'output')
    emitActualCost({ agents: [] }, { GITHUB_OUTPUT: output })
    await expect(readFile(output, 'utf8')).rejects.toThrow()
  })
})

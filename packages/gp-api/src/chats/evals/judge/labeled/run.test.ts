import { describe, expect, it } from 'vitest'
import type { AgentEntry } from '../agents'
import type { LabeledCase } from '../cases'
import { RunRecordSchema } from '../record'
import type { ArmCaseRequest } from '../sweepArm'
import { LABELED_ADAPTERS } from './adapters'
import { replyIntentAdapter } from './replyIntent.adapter'
import { runLabeledCase } from './run'
import type { LabeledAdapter, LabeledRunContext } from './types'

const AGENT: AgentEntry = {
  agentId: 'reply_intent',
  shape: 'labeled',
  cases: 'reply_intent.json',
  status: 'pending',
}

const CASE: LabeledCase = {
  caseId: 'stop_plain',
  input: { text: 'STOP', channel: 'text' },
  expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
}

const request = (over: Partial<ArmCaseRequest> = {}): ArmCaseRequest => ({
  agent: AGENT,
  case: CASE,
  attempt: 1,
  sweepId: 'swp_labeled',
  arm: 'candidate',
  variant: { ref: 'feat/x', commit: 'c'.repeat(40) },
  spends: false,
  ...over,
})

const clock = () => {
  let ms = Date.parse('2026-11-18T00:00:00.000Z')
  return () => {
    const now = new Date(ms)
    ms += 5
    return now
  }
}

describe('replyIntentAdapter', () => {
  it.each([
    ['STOP', { optOut: true, civicPanelJoin: false, civicPanelLeave: false }],
    ['JOIN', { optOut: false, civicPanelJoin: true, civicPanelLeave: false }],
    ['LEAVE', { optOut: false, civicPanelJoin: false, civicPanelLeave: true }],
    [
      'Thanks for the update!',
      { optOut: false, civicPanelJoin: false, civicPanelLeave: false },
    ],
  ])('answers %s with the production predicates', async (text, expected) => {
    const result = await replyIntentAdapter(
      { text, channel: 'text' },
      { spends: false },
    )
    expect(result.model).toBe('regex')
    expect(result.usage).toBeUndefined()
    expect(
      Object.fromEntries(
        Object.entries(result.labels).map(([name, a]) => [name, a.value]),
      ),
    ).toEqual(expected)
    // Hard labels: a regex has no distribution to give.
    for (const answer of Object.values(result.labels)) {
      expect(answer.probabilities).toBeUndefined()
    }
  })

  it('is the registered adapter for reply_intent', () => {
    expect(LABELED_ADAPTERS.reply_intent).toBe(replyIntentAdapter)
  })
})

describe('runLabeledCase', () => {
  it('writes a valid record whose output is the labels', async () => {
    const record = await runLabeledCase(request(), {
      adapters: { reply_intent: replyIntentAdapter },
      now: clock(),
    })
    expect(RunRecordSchema.safeParse(record).success).toBe(true)
    expect(record).toMatchObject({
      agentId: 'reply_intent',
      agentShape: 'labeled',
      arm: 'candidate',
      caseId: 'stop_plain',
      attempt: 1,
      status: 'produced',
      runId: 'swp_labeled:reply_intent:stop_plain:candidate:1',
      input: { kind: 'labeled', value: { text: 'STOP', channel: 'text' } },
      output: {
        kind: 'labels',
        value: {
          optOut: { value: true },
          civicPanelJoin: { value: false },
          civicPanelLeave: { value: false },
        },
      },
      variant: { ref: 'feat/x', model: 'regex' },
    })
    // A free arm is priced at zero, not left unmeasured.
    expect(record.telemetry.cost?.usdAtCapture).toBe(0)
    expect(record.telemetry.latencyMs).toBe(5)
  })

  it('hands the adapter the spend switch', async () => {
    const seen: LabeledRunContext[] = []
    const adapter: LabeledAdapter = async (_input, ctx) => {
      seen.push(ctx)
      return { labels: { optOut: { value: true } } }
    }
    await runLabeledCase(request({ spends: false }), {
      adapters: { reply_intent: adapter },
    })
    await runLabeledCase(request({ spends: true }), {
      adapters: { reply_intent: adapter },
    })
    expect(seen).toEqual([{ spends: false }, { spends: true }])
  })

  it("records the adapter's bill, tokens and probabilities", async () => {
    const adapter: LabeledAdapter = async () => ({
      labels: { optOut: { value: true, probabilities: { true: 0.97 } } },
      usage: { inputTokens: 40, costUsd: 0.0009 },
      model: 'decision-model-x',
    })
    const record = await runLabeledCase(request({ spends: true }), {
      adapters: { reply_intent: adapter },
    })
    expect(record.telemetry.tokens.input).toBe(40)
    expect(record.telemetry.cost?.usdAtCapture).toBe(0.0009)
    expect(record.variant.model).toBe('decision-model-x')
    expect(record.output?.value).toEqual({
      optOut: { value: true, probabilities: { true: 0.97 } },
    })
  })

  // Never a silent fallback: a failed classifier is an excluded run the
  // report counts, not an answer.
  it('records an adapter that throws as an infraError', async () => {
    const adapter: LabeledAdapter = async () => {
      throw new Error('the decision API answered 503')
    }
    const record = await runLabeledCase(request(), {
      adapters: { reply_intent: adapter },
    })
    expect(record.status).toBe('infraError')
    expect(record.output).toBeNull()
    expect(record.trace).toEqual([
      { index: 0, kind: 'error', error: 'the decision API answered 503' },
    ])
    expect(record.telemetry.cost).toBeUndefined()
  })

  // Its own wrong answer, not a harness fault: the scorer reads no labels
  // and counts every one as missed.
  it('records an adapter that returns no readable labels as blocked, with none', async () => {
    const adapter: LabeledAdapter = async () => ({
      labels: { optOut: { value: true, probabilities: { true: 1.5 } } },
    })
    const record = await runLabeledCase(request(), {
      adapters: { reply_intent: adapter },
    })
    expect(record.status).toBe('blocked')
    expect(record.output).toEqual({ kind: 'labels', value: {} })
    expect(record.trace[0]?.error).toContain('no readable labels')
  })

  it('throws for an agent with no adapter, so the arm skips it by name', async () => {
    await expect(runLabeledCase(request(), { adapters: {} })).rejects.toThrow(
      /reply_intent is a labeled agent with no adapter/,
    )
  })

  it('throws for a case with no expected labels', async () => {
    await expect(
      runLabeledCase(request({ case: { caseId: 'chat', question: 'hi' } })),
    ).rejects.toThrow(/not a labeled case/)
  })
})

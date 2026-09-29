import { describe, expect, it } from 'vitest'
import { isComparable, RunRecordSchema } from './record'
import {
  ALL_PAIRS,
  BLOCKED_PAIR,
  CHAT_PAIR,
  IDENTICAL_DIGEST_PAIR,
  INFRA_ERROR_PAIR,
  TOOL_ERROR_PAIR,
} from './fixtures/records'

describe('RunRecordSchema', () => {
  // The fixtures are the contract every other build track works against, so
  // a fixture that does not satisfy the schema is worse than no fixture.
  it.each(Object.entries(ALL_PAIRS))('%s parses on both arms', (_, pair) => {
    for (const record of pair) {
      expect(RunRecordSchema.safeParse(record).success).toBe(true)
    }
  })

  it('rejects a produced record with no output', () => {
    const [, candidate] = CHAT_PAIR
    const result = RunRecordSchema.safeParse({ ...candidate, output: null })
    expect(result.success).toBe(false)
  })

  it('rejects an infraError record that carries an output', () => {
    const [, candidate] = INFRA_ERROR_PAIR
    const result = RunRecordSchema.safeParse({
      ...candidate,
      output: { kind: 'text', value: 'something' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects more tool errors than tool calls', () => {
    const [, candidate] = TOOL_ERROR_PAIR
    const result = RunRecordSchema.safeParse({
      ...candidate,
      telemetry: { ...candidate.telemetry, toolCalls: 0, toolErrors: 1 },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a run that ended before it started', () => {
    const [base] = CHAT_PAIR
    const result = RunRecordSchema.safeParse({
      ...base,
      startedAt: '2026-01-01T00:00:12.000Z',
      endedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })

  it('carries an opaque background artifact without a special case', () => {
    const [, candidate] = ALL_PAIRS.BACKGROUND_PAIR
    const parsed = RunRecordSchema.parse(candidate)
    expect(parsed.output?.kind).toBe('artifact')
    expect(parsed.agentShape).toBe('background')
  })
})

describe('CI provenance', () => {
  // The point of carrying this: a record should lead back to the change it
  // judged, not just to a commit hash floating free of any PR.
  it('links a record to the PR and the workflow run', () => {
    const [base] = CHAT_PAIR
    expect(base.ci?.prNumber).toBe(2198)
    expect(base.ci?.workflowRunUrl).toContain('/actions/runs/')
  })

  // The naming trap this field exists to avoid.
  it('keeps the workflow run distinct from the agent run', () => {
    const [base] = CHAT_PAIR
    expect(base.ci?.workflowRunId).not.toBe(base.runId)
  })

  // A local run has no CI to point at, so the absence has to be legal.
  it('is optional', () => {
    const [, candidate] = ALL_PAIRS.BACKGROUND_PAIR
    expect(candidate.ci).toBeUndefined()
    expect(RunRecordSchema.safeParse(candidate).success).toBe(true)
  })

  it('rejects a malformed run url', () => {
    const [base] = CHAT_PAIR
    const result = RunRecordSchema.safeParse({
      ...base,
      ci: { ...base.ci, workflowRunUrl: 'not-a-url' },
    })
    expect(result.success).toBe(false)
  })
})

describe('cost and tokens', () => {
  // Cache counts are zero today because caching is off. Carrying the fields
  // now is what stops every stored cost going quietly wrong the day it is
  // switched on.
  it('splits tokens by how they are billed', () => {
    const [base] = CHAT_PAIR
    expect(base.telemetry.tokens).toEqual({
      input: 31_213,
      output: 227,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  // The stored figure is a snapshot, so it only means anything alongside the
  // table that produced it.
  it('stamps cost with the pricing version that produced it', () => {
    const [base] = CHAT_PAIR
    expect(base.telemetry.cost.pricingVersion).toBeTruthy()
  })

  it('rejects a cost with no pricing version', () => {
    const [base] = CHAT_PAIR
    const result = RunRecordSchema.safeParse({
      ...base,
      telemetry: {
        ...base.telemetry,
        cost: { usdAtCapture: 0.1, pricingVersion: '' },
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative token counts', () => {
    const [base] = CHAT_PAIR
    const result = RunRecordSchema.safeParse({
      ...base,
      telemetry: {
        ...base.telemetry,
        tokens: { ...base.telemetry.tokens, cacheRead: -1 },
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('fixture immutability', () => {
  // Nine build tracks import these same objects. A test that mutated one
  // would corrupt another track's input with no visible link between them,
  // so the failure is made loud at the point of mutation instead.
  it('refuses mutation of a shared fixture', () => {
    const [base] = CHAT_PAIR
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(base.telemetry as any).toolErrors = 99
    }).toThrow()
  })

  it('still allows a spread to build a variant', () => {
    const [base] = CHAT_PAIR
    const variant = { ...base, liveWeb: true }
    expect(variant.liveWeb).toBe(true)
    expect(base.liveWeb).toBe(false)
  })
})

describe('isComparable', () => {
  it('accepts a clean pair', () => {
    expect(CHAT_PAIR.every(isComparable)).toBe(true)
  })

  // The whole point: a broken tool leaves a coherent answer behind, so
  // without this a dead credential reads as a code regression.
  it('rejects an arm that hit a tool error', () => {
    const [base, candidate] = TOOL_ERROR_PAIR
    expect(isComparable(base)).toBe(true)
    expect(isComparable(candidate)).toBe(false)
  })

  it('rejects an infraError arm', () => {
    const [, candidate] = INFRA_ERROR_PAIR
    expect(isComparable(candidate)).toBe(false)
  })

  // A refusal is an agent result. Whether declining was correct is exactly
  // what a verdict should capture, so it stays comparable.
  it('keeps a declined arm comparable', () => {
    expect(BLOCKED_PAIR.every(isComparable)).toBe(true)
  })
})

describe('config digests', () => {
  it('differ across arms in every pair meant to be judged', () => {
    for (const [name, [base, candidate]] of Object.entries(ALL_PAIRS)) {
      if (name === 'IDENTICAL_DIGEST_PAIR') continue
      expect(
        base.variant.configDigest,
        `${name} arms must differ or there is nothing to compare`,
      ).not.toBe(candidate.variant.configDigest)
    }
  })

  it('match in the pair that exists to be refused', () => {
    const [base, candidate] = IDENTICAL_DIGEST_PAIR
    expect(base.variant.configDigest).toBe(candidate.variant.configDigest)
  })
})

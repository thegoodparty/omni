import { describe, expect, it } from 'vitest'
import {
  MAX_DIFF_BYTES,
  MAX_REASON_CHARS,
  finalAgentSet,
  sanitizeReason,
  truncateDiff,
  validatePickerOutput,
} from './picker'

describe('sanitizeReason', () => {
  it('strips links', () => {
    expect(sanitizeReason('see https://evil.example/x for details')).toBe(
      'see [link removed] for details',
    )
  })

  it('caps length at MAX_REASON_CHARS', () => {
    const long = 'a'.repeat(MAX_REASON_CHARS + 50)
    const result = sanitizeReason(long)
    expect(result.length).toBeLessThanOrEqual(MAX_REASON_CHARS)
    expect(result.endsWith('…')).toBe(true)
  })

  it('leaves a short, link-free reason untouched', () => {
    expect(sanitizeReason('touches the shared LLM client')).toBe(
      'touches the shared LLM client',
    )
  })
})

describe('validatePickerOutput', () => {
  const registry = new Set(['chief_of_staff', 'campaign_assistant'])

  it('drops an unregistered agent id and keeps the rest', () => {
    const { add, droppedIds } = validatePickerOutput(
      {
        add: [
          { agentId: 'chief_of_staff', reason: 'shares the LLM client' },
          { agentId: 'not_a_real_agent', reason: 'made up' },
        ],
      },
      registry,
    )
    expect(add).toEqual([
      { agentId: 'chief_of_staff', reason: 'shares the LLM client' },
    ])
    expect(droppedIds).toEqual(['not_a_real_agent'])
  })

  it('allows a response naming zero additions', () => {
    const { add, droppedIds } = validatePickerOutput({ add: [] }, registry)
    expect(add).toEqual([])
    expect(droppedIds).toEqual([])
  })

  it('sanitizes an over-length, linky reason rather than dropping it', () => {
    const longLinky = `${'x'.repeat(MAX_REASON_CHARS)} https://evil.example`
    const { add } = validatePickerOutput(
      { add: [{ agentId: 'chief_of_staff', reason: longLinky }] },
      registry,
    )
    expect(add).toHaveLength(1)
    expect(add[0]?.reason).not.toContain('http')
    expect(add[0]?.reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS)
  })
})

describe('finalAgentSet', () => {
  it('never removes a floor-matched agent', () => {
    const result = finalAgentSet(['chief_of_staff'], [])
    expect(result).toEqual(['chief_of_staff'])
  })

  it('unions the floor with validated additions, de-duplicated', () => {
    const result = finalAgentSet(
      ['chief_of_staff'],
      [
        { agentId: 'campaign_assistant', reason: 'r' },
        { agentId: 'chief_of_staff', reason: 'already on the floor' },
      ],
    )
    expect(result).toEqual(['chief_of_staff', 'campaign_assistant'])
  })
})

describe('truncateDiff', () => {
  it('leaves a small diff unchanged', () => {
    const { diff, truncated } = truncateDiff('a small diff', 1024)
    expect(diff).toBe('a small diff')
    expect(truncated).toBe(false)
  })

  it('truncates with a marker rather than rejecting an oversized diff', () => {
    const big = 'x'.repeat(MAX_DIFF_BYTES * 2)
    const { diff, truncated } = truncateDiff(big)
    expect(truncated).toBe(true)
    expect(Buffer.byteLength(diff, 'utf8')).toBeLessThanOrEqual(MAX_DIFF_BYTES)
    expect(diff).toContain('diff truncated')
  })
})

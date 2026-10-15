import { describe, expect, it } from 'vitest'
import {
  ServePollCreateSchema,
  ServePollDraftRequestSchema,
} from './ServePoll.schema'
import { PollResultsSchema } from './PollResults.schema'

const validCreate = {
  topic: 'schools',
  question: 'What matters most to you about our schools?',
  audience: { kind: 'sample', size: 200 },
  scheduledLocalDate: '2026-11-03',
  biasOverridden: false,
}

describe('ServePollCreateSchema', () => {
  it.each([
    [9, false],
    [10, true],
    [480, true],
    [481, false],
  ])('a %i-char question parses: %s', (length, ok) => {
    const result = ServePollCreateSchema.safeParse({
      ...validCreate,
      question: 'q'.repeat(length),
    })
    expect(result.success).toBe(ok)
  })

  it('rejects a sample audience without a size', () => {
    expect(
      ServePollCreateSchema.safeParse({
        ...validCreate,
        audience: { kind: 'sample' },
      }).success,
    ).toBe(false)
  })

  it('rejects a list audience without a voterFileFilterId', () => {
    expect(
      ServePollCreateSchema.safeParse({
        ...validCreate,
        audience: { kind: 'list' },
      }).success,
    ).toBe(false)
  })

  it('accepts a list audience with a voterFileFilterId', () => {
    expect(
      ServePollCreateSchema.safeParse({
        ...validCreate,
        audience: { kind: 'list', voterFileFilterId: 7 },
      }).success,
    ).toBe(true)
  })
})

describe('ServePollDraftRequestSchema', () => {
  it('rejects an unknown tone', () => {
    expect(
      ServePollDraftRequestSchema.safeParse({
        topic: 'schools',
        tone: 'Aggressive',
      }).success,
    ).toBe(false)
  })
})

describe('PollResultsSchema', () => {
  it('parses notEnoughResponses with no themes and null confidence', () => {
    const parsed = PollResultsSchema.parse({
      outreachId: 1,
      sent: 100,
      responses: 3,
      responseRate: 0.03,
      optOutRate: 0,
      confidence: null,
      isHighConfidence: false,
      notEnoughResponses: true,
      newSinceLastAnalysis: 3,
      lastAnalysisAt: null,
      themes: [],
      nonClustered: { count: 0 },
      analysis: { status: 'none' },
      expansions: [],
    })
    expect(parsed.themes).toEqual([])
    expect(parsed.confidence).toBeNull()
  })
})

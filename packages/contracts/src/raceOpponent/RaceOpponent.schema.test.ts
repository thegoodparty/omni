import { describe, it, expect } from 'vitest'
import {
  RaceOpponentFindingSchema,
  RaceOpponentContrastSchema,
  RaceOpponentResearchSchema,
  RaceOpponentResponseSchema,
} from './index'

const validFinding = {
  id: 1,
  researchId: 10,
  claim: 'Opponent voted against the budget',
  sourceUrl: 'https://ballotpedia.org/example',
  sourceExtract: 'The record shows a no vote on HB 1.',
  sourceTitle: null,
  sourceReachableAt: '2026-06-27T00:00:00.000Z',
  category: 'voting-record',
  occurredAt: null,
  draftedResponse: null,
  createdAt: '2026-06-27T00:00:00.000Z',
}

const validContrast = {
  id: 1,
  opponentFact: 'Opponent opposed the road repair bond.',
  sourceUrl: 'https://ballotpedia.org/example',
  candidateFact: 'I sponsored the road repair bond.',
  contrastSentence: 'While they blocked repairs, I funded them.',
  issueTag: 'infrastructure',
  routing: 'story',
  status: 'draft',
  editCount: 0,
  findingId: 1,
  routedWebsiteId: null,
  routedOutreachId: null,
  createdAt: '2026-06-27T00:00:00.000Z',
  updatedAt: '2026-06-27T00:00:00.000Z',
}

const validResearch = {
  id: 1,
  kind: 'opponent',
  opponentName: 'Jane Doe',
  electionCandidacyId: 'cand-123',
  status: 'completed',
  runId: 'run-abc',
  attempts: 1,
  completedAt: '2026-06-27T00:00:00.000Z',
  lastViewedAt: null,
  createdAt: '2026-06-27T00:00:00.000Z',
  updatedAt: '2026-06-27T00:00:00.000Z',
}

describe('RaceOpponentFindingSchema', () => {
  it('parses a valid sourced finding', () => {
    expect(RaceOpponentFindingSchema.parse(validFinding)).toMatchObject({
      sourceUrl: validFinding.sourceUrl,
      sourceExtract: validFinding.sourceExtract,
    })
  })

  it('parses sourceReachableAt as null (not network-verified)', () => {
    const result = RaceOpponentFindingSchema.parse({
      ...validFinding,
      sourceReachableAt: null,
    })
    expect(result.sourceReachableAt).toBeNull()
  })

  it('rejects a finding missing sourceUrl', () => {
    const { sourceUrl, ...withoutSourceUrl } = validFinding
    expect(RaceOpponentFindingSchema.safeParse(withoutSourceUrl).success).toBe(
      false,
    )
  })

  it('rejects a finding with an empty sourceUrl', () => {
    expect(
      RaceOpponentFindingSchema.safeParse({ ...validFinding, sourceUrl: '' })
        .success,
    ).toBe(false)
  })

  it('rejects a finding missing sourceExtract', () => {
    const { sourceExtract, ...withoutExtract } = validFinding
    expect(RaceOpponentFindingSchema.safeParse(withoutExtract).success).toBe(
      false,
    )
  })

  it('rejects a finding with an empty sourceExtract', () => {
    expect(
      RaceOpponentFindingSchema.safeParse({
        ...validFinding,
        sourceExtract: '',
      }).success,
    ).toBe(false)
  })
})

describe('RaceOpponentContrastSchema', () => {
  it('parses a valid contrast', () => {
    expect(RaceOpponentContrastSchema.parse(validContrast)).toMatchObject({
      routing: 'story',
      issueTag: 'infrastructure',
    })
  })

  const sixRequired = [
    'opponentFact',
    'sourceUrl',
    'candidateFact',
    'contrastSentence',
    'issueTag',
    'routing',
  ] as const

  it.each(sixRequired)('rejects a contrast missing %s', (field) => {
    const { [field]: _omitted, ...rest } = validContrast
    expect(RaceOpponentContrastSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects an empty required content field', () => {
    expect(
      RaceOpponentContrastSchema.safeParse({
        ...validContrast,
        contrastSentence: '',
      }).success,
    ).toBe(false)
  })

  it('rejects an unknown routing value', () => {
    expect(
      RaceOpponentContrastSchema.safeParse({
        ...validContrast,
        routing: 'billboard',
      }).success,
    ).toBe(false)
  })
})

describe('RaceOpponentResearchSchema', () => {
  it('parses a valid research row', () => {
    expect(RaceOpponentResearchSchema.parse(validResearch)).toMatchObject({
      kind: 'opponent',
      status: 'completed',
    })
  })

  it('allows null opponentName for self-research', () => {
    const result = RaceOpponentResearchSchema.parse({
      ...validResearch,
      kind: 'self',
      opponentName: null,
      electionCandidacyId: null,
    })
    expect(result.opponentName).toBeNull()
  })

  it('rejects an unknown status', () => {
    expect(
      RaceOpponentResearchSchema.safeParse({
        ...validResearch,
        status: 'paused',
      }).success,
    ).toBe(false)
  })
})

describe('RaceOpponentResponseSchema', () => {
  const rawItem = {
    id: 1,
    opponentName: 'Jane Doe',
    sourceType: 'ballotpedia',
    sourceUrl: 'https://ballotpedia.org/Jane_Doe',
    content: { text: 'bio' },
    collectedAt: '2026-06-27T00:00:00.000Z',
  }
  const opponent = { opponentName: 'Jane Doe', party: null, isIncumbent: null }
  const response = {
    opponents: [opponent],
    lastCollectedAt: null,
    collectionStatus: 'completed',
  }

  it('parses an opponent with no items (gp-api omits them once a summary exists)', () => {
    const result = RaceOpponentResponseSchema.parse(response)
    expect(result.opponents[0]?.items).toBeUndefined()
  })

  it('still parses an opponent that carries raw items (no-summary fallback)', () => {
    const result = RaceOpponentResponseSchema.parse({
      ...response,
      opponents: [{ ...opponent, items: [rawItem] }],
    })
    expect(result.opponents[0]?.items).toHaveLength(1)
  })
})

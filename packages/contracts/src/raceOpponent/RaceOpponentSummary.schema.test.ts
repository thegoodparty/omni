import { describe, it, expect } from 'vitest'
import {
  RaceOpponentSummarySchema,
  RaceOpponentResponseSchema,
} from './index'

const validSummary = {
  opponentName: 'Jane Doe',
  overview: {
    text: 'A two-term city council member focused on housing.',
    sources: [
      {
        sourceType: 'ballotpedia',
        sourceUrl: 'https://ballotpedia.org/Jane_Doe',
      },
    ],
  },
  background: {
    text: 'Served on the planning commission before election.',
    sources: [
      {
        sourceType: 'opponent_website',
        sourceUrl: 'https://janedoe.example.com/about',
      },
    ],
  },
  keyPositions: [
    {
      label: 'Housing',
      detail: 'Supports zoning reform to increase supply.',
      sources: [
        {
          sourceType: 'ballotpedia',
          sourceUrl: 'https://ballotpedia.org/Jane_Doe',
        },
      ],
    },
  ],
  generatedAt: '2026-06-27T00:00:00.000Z',
}

describe('RaceOpponentSummarySchema', () => {
  it('parses a valid fully-sourced summary', () => {
    expect(RaceOpponentSummarySchema.parse(validSummary)).toMatchObject({
      opponentName: 'Jane Doe',
    })
  })

  it('accepts a null overview section', () => {
    const result = RaceOpponentSummarySchema.parse({
      ...validSummary,
      overview: null,
    })
    expect(result.overview).toBeNull()
  })

  it('accepts an empty keyPositions array', () => {
    const result = RaceOpponentSummarySchema.parse({
      ...validSummary,
      keyPositions: [],
    })
    expect(result.keyPositions).toEqual([])
  })

  it('rejects an overview section with an empty sources array', () => {
    expect(
      RaceOpponentSummarySchema.safeParse({
        ...validSummary,
        overview: { text: 'Some claim.', sources: [] },
      }).success,
    ).toBe(false)
  })

  it('rejects a key position with an empty sources array', () => {
    expect(
      RaceOpponentSummarySchema.safeParse({
        ...validSummary,
        keyPositions: [{ label: 'Housing', detail: 'Reform.', sources: [] }],
      }).success,
    ).toBe(false)
  })

  it('rejects a source ref with an empty sourceUrl', () => {
    expect(
      RaceOpponentSummarySchema.safeParse({
        ...validSummary,
        overview: {
          text: 'Some claim.',
          sources: [{ sourceType: 'ballotpedia', sourceUrl: '' }],
        },
      }).success,
    ).toBe(false)
  })

  it('rejects a source ref with an unknown sourceType', () => {
    expect(
      RaceOpponentSummarySchema.safeParse({
        ...validSummary,
        overview: {
          text: 'Some claim.',
          sources: [{ sourceType: 'twitter', sourceUrl: 'https://x.com/jd' }],
        },
      }).success,
    ).toBe(false)
  })
})

describe('RaceOpponentResponseSchema summary field', () => {
  const baseOpponent = {
    opponentName: 'Jane Doe',
    party: null,
    isIncumbent: null,
    items: [],
  }

  it('accepts a null summary per opponent', () => {
    const result = RaceOpponentResponseSchema.parse({
      opponents: [{ ...baseOpponent, summary: null }],
      lastCollectedAt: null,
      collectionStatus: 'completed',
    })
    expect(result.opponents[0].summary).toBeNull()
  })

  it('accepts a populated summary per opponent', () => {
    const result = RaceOpponentResponseSchema.parse({
      opponents: [{ ...baseOpponent, summary: validSummary }],
      lastCollectedAt: null,
      collectionStatus: 'completed',
    })
    expect(result.opponents[0].summary?.opponentName).toBe('Jane Doe')
  })
})

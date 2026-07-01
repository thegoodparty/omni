import { describe, it, expect } from 'vitest'
import { RaceOpponentSummarySchema, RaceOpponentResponseSchema } from './index'

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

const analysisFields = {
  threatTier: 'primary_threat',
  whyTheyMatter: 'The only incumbent in the field.',
  whatYouNeedToKnow: [
    {
      text: 'Two-term incumbent.',
      sources: [
        {
          sourceType: 'ballotpedia',
          sourceUrl: 'https://ballotpedia.org/Jane_Doe',
        },
      ],
    },
    // relaxed sourcing: an interpretive takeaway with no source still parses
    { text: 'Backed by the local PAC.' },
  ],
  whereSoft: [
    {
      text: 'No published long-term water position.',
      sources: [
        {
          sourceType: 'ballotpedia',
          sourceUrl: 'https://ballotpedia.org/Jane_Doe',
        },
      ],
    },
    // relaxed sourcing: an item with no source still parses
    { text: 'Skipped the candidate survey.' },
  ],
  issueContrasts: [
    {
      issue: 'Housing',
      salience: 'high',
      whyItMatters: 'Families are being priced out.',
      opponentStance: 'Opposes new zoning.',
      opponentSources: [
        {
          sourceType: 'opponent_website',
          sourceUrl: 'https://janedoe.example.com/about',
        },
      ],
      candidateStance: 'Supports more starter homes.',
    },
  ],
}

describe('RaceOpponentSummarySchema analysis fields', () => {
  it('parses a fully-populated analysis summary', () => {
    const result = RaceOpponentSummarySchema.parse({
      ...validSummary,
      ...analysisFields,
    })
    expect(result.threatTier).toBe('primary_threat')
    expect(result.issueContrasts?.[0].salience).toBe('high')
    expect(result.whereSoft?.[1].sources).toBeUndefined()
    // relaxed sourcing on takeaways: the sourced one keeps its ref, the
    // interpretive one persists with no sources key.
    expect(result.whatYouNeedToKnow?.[0].sources).toEqual([
      {
        sourceType: 'ballotpedia',
        sourceUrl: 'https://ballotpedia.org/Jane_Doe',
      },
    ])
    expect(result.whatYouNeedToKnow?.[1].sources).toBeUndefined()
  })

  it('normalizes a legacy string[] whatYouNeedToKnow to { text } items', () => {
    // Summaries persisted before the {text, sources?} migration are stored as a
    // JSONB blob and re-validated on read; the legacy bare-string form must
    // parse (and normalize) rather than being dropped.
    const result = RaceOpponentSummarySchema.parse({
      ...validSummary,
      whatYouNeedToKnow: ['Two-term incumbent.', 'Backed by the local PAC.'],
    })
    expect(result.whatYouNeedToKnow).toEqual([
      { text: 'Two-term incumbent.' },
      { text: 'Backed by the local PAC.' },
    ])
  })

  it('parses a summary with no analysis fields (all optional)', () => {
    const result = RaceOpponentSummarySchema.parse(validSummary)
    expect(result.threatTier).toBeUndefined()
    expect(result.issueContrasts).toBeUndefined()
  })

  it('rejects an unknown threat tier', () => {
    expect(
      RaceOpponentSummarySchema.safeParse({
        ...validSummary,
        threatTier: 'existential',
      }).success,
    ).toBe(false)
  })

  it('rejects an unknown issue salience', () => {
    expect(
      RaceOpponentSummarySchema.safeParse({
        ...validSummary,
        issueContrasts: [
          { ...analysisFields.issueContrasts[0], salience: 'critical' },
        ],
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

  it('accepts an opponent-level threatTier and omits it cleanly', () => {
    const withTier = RaceOpponentResponseSchema.parse({
      opponents: [{ ...baseOpponent, threatTier: 'watch_closely' }],
      lastCollectedAt: null,
      collectionStatus: 'completed',
    })
    expect(withTier.opponents[0].threatTier).toBe('watch_closely')
    const without = RaceOpponentResponseSchema.parse({
      opponents: [baseOpponent],
      lastCollectedAt: null,
      collectionStatus: 'completed',
    })
    expect(without.opponents[0].threatTier).toBeUndefined()
  })

  it('accepts a null summary per opponent', () => {
    const result = RaceOpponentResponseSchema.parse({
      opponents: [{ ...baseOpponent, summary: null }],
      lastCollectedAt: null,
      collectionStatus: 'completed',
    })
    expect(result.opponents[0].summary).toBeNull()
  })

  it('accepts an opponent with the summary field omitted', () => {
    const result = RaceOpponentResponseSchema.parse({
      opponents: [baseOpponent],
      lastCollectedAt: null,
      collectionStatus: 'completed',
    })
    expect(result.opponents[0].summary).toBeUndefined()
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

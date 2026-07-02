import { describe, it, expect } from 'vitest'
import {
  RaceOpponentSummarySchema,
  RaceOpponentResponseSchema,
  RaceOpponentFieldAnalysisSchema,
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
    // relaxed sourcing on takeaways: the sourced one keeps its ref (normalized
    // to the rich shape), the interpretive one persists with no sources key.
    expect(result.whatYouNeedToKnow?.[0].sources).toEqual([
      {
        url: 'https://ballotpedia.org/Jane_Doe',
        title: 'ballotpedia.org',
        publisher: 'ballotpedia.org',
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

const richSource = {
  url: 'https://ballotpedia.org/Jane_Doe',
  title: 'Jane Doe - Ballotpedia',
  publisher: 'Ballotpedia',
}

describe('RaceOpponentSummarySchema legacy source normalization', () => {
  it('normalizes a legacy {sourceType, sourceUrl} source to the rich shape', () => {
    const result = RaceOpponentSummarySchema.parse({
      ...validSummary,
      overview: {
        text: validSummary.overview.text,
        sources: [
          {
            sourceType: 'ballotpedia',
            sourceUrl: 'https://ballotpedia.org/X',
          },
        ],
      },
    })
    expect(result.overview?.sources).toEqual([
      {
        url: 'https://ballotpedia.org/X',
        title: 'ballotpedia.org',
        publisher: 'ballotpedia.org',
        sourceType: 'ballotpedia',
        sourceUrl: 'https://ballotpedia.org/X',
      },
    ])
  })

  it('falls back to the raw string when a legacy sourceUrl is not a valid URL', () => {
    const result = RaceOpponentSummarySchema.parse({
      ...validSummary,
      overview: {
        text: validSummary.overview.text,
        sources: [
          {
            sourceType: 'ballotpedia',
            sourceUrl: 'ballotpedia.org/Jane_Doe',
          },
        ],
      },
    })
    expect(result.overview?.sources).toEqual([
      {
        url: 'ballotpedia.org/Jane_Doe',
        title: 'ballotpedia.org/Jane_Doe',
        publisher: 'ballotpedia.org/Jane_Doe',
        sourceType: 'ballotpedia',
        sourceUrl: 'ballotpedia.org/Jane_Doe',
      },
    ])
  })

  it('round-trips a normalized 5-key source without stripping the legacy keys', () => {
    // gp-api persists the PARSED summary, so a re-read of a post-normalization
    // row hits the rich union branch with the legacy keys still present.
    const normalized = {
      url: 'https://ballotpedia.org/X',
      title: 'ballotpedia.org',
      publisher: 'ballotpedia.org',
      sourceType: 'ballotpedia',
      sourceUrl: 'https://ballotpedia.org/X',
    }
    const result = RaceOpponentSummarySchema.parse({
      ...validSummary,
      overview: { text: validSummary.overview.text, sources: [normalized] },
    })
    expect(result.overview?.sources).toEqual([normalized])
  })

  it('parses a rich source through unchanged', () => {
    const result = RaceOpponentSummarySchema.parse({
      ...validSummary,
      overview: {
        text: validSummary.overview.text,
        sources: [{ ...richSource, description: 'Candidate profile page.' }],
      },
    })
    expect(result.overview?.sources).toEqual([
      { ...richSource, description: 'Candidate profile page.' },
    ])
  })
})

describe('RaceOpponentSummarySchema legacy full-summary fixture', () => {
  // Shape of a pre-ENG-10630 persisted sections blob: no whyTheyreRunning /
  // issuesThatMatter, legacy {sourceType, sourceUrl} refs throughout. Must
  // keep parsing so the read endpoint doesn't 500 on existing campaigns.
  const legacySummary = {
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
    generatedAt: '2026-06-01T00:00:00.000Z',
    threatTier: 'primary_threat',
    whyTheyMatter: 'The only incumbent in the field.',
    whatYouNeedToKnow: ['Two-term incumbent.'],
    whereSoft: [{ text: 'No published long-term water position.' }],
    issueContrasts: [],
  }

  it('parses a legacy sections blob with no v2 fields', () => {
    const result = RaceOpponentSummarySchema.parse(legacySummary)
    expect(result.whyTheyreRunning).toBeUndefined()
    expect(result.issuesThatMatter).toBeUndefined()
    expect(result.overview?.sources[0]).toEqual({
      url: 'https://ballotpedia.org/Jane_Doe',
      title: 'ballotpedia.org',
      publisher: 'ballotpedia.org',
      sourceType: 'ballotpedia',
      sourceUrl: 'https://ballotpedia.org/Jane_Doe',
    })
    expect(result.keyPositions?.[0].sources[0]).toEqual({
      url: 'https://ballotpedia.org/Jane_Doe',
      title: 'ballotpedia.org',
      publisher: 'ballotpedia.org',
      sourceType: 'ballotpedia',
      sourceUrl: 'https://ballotpedia.org/Jane_Doe',
    })
  })
})

describe('RaceOpponentSummarySchema v2 fields', () => {
  const v2Summary = {
    opponentName: 'Jane Doe',
    overview: {
      text: 'A two-term city council member.',
      sources: [richSource],
    },
    background: {
      text: 'Served on the planning commission.',
      sources: [richSource],
    },
    generatedAt: '2026-07-01T00:00:00.000Z',
    threatTier: 'primary_threat',
    whyTheyreRunning: {
      text: 'Running to protect the incumbent housing agenda.',
    },
    issuesThatMatter: { items: ['Housing'], sources: [richSource] },
  }

  it('parses a v2-shaped summary', () => {
    const result = RaceOpponentSummarySchema.parse(v2Summary)
    expect(result.whyTheyreRunning).toEqual({
      text: 'Running to protect the incumbent housing agenda.',
    })
    expect(result.issuesThatMatter).toEqual({
      items: ['Housing'],
      sources: [richSource],
    })
  })

  it('rejects a non-null overview missing sources', () => {
    const { sources: _sources, ...overviewWithoutSources } = v2Summary.overview
    expect(
      RaceOpponentSummarySchema.safeParse({
        ...v2Summary,
        overview: overviewWithoutSources,
      }).success,
    ).toBe(false)
  })

  it('rejects issuesThatMatter with an empty sources array', () => {
    expect(
      RaceOpponentSummarySchema.safeParse({
        ...v2Summary,
        issuesThatMatter: { items: ['Housing'], sources: [] },
      }).success,
    ).toBe(false)
  })

  it('rejects issuesThatMatter with an empty items array', () => {
    expect(
      RaceOpponentSummarySchema.safeParse({
        ...v2Summary,
        issuesThatMatter: { items: [], sources: [richSource] },
      }).success,
    ).toBe(false)
  })

  it('accepts a null whyTheyreRunning and issuesThatMatter', () => {
    const result = RaceOpponentSummarySchema.parse({
      ...v2Summary,
      whyTheyreRunning: null,
      issuesThatMatter: null,
    })
    expect(result.whyTheyreRunning).toBeNull()
    expect(result.issuesThatMatter).toBeNull()
  })

  it('accepts whyTheyreRunning and issuesThatMatter omitted entirely', () => {
    const { whyTheyreRunning: _w, issuesThatMatter: _i, ...rest } = v2Summary
    const result = RaceOpponentSummarySchema.parse(rest)
    expect(result.whyTheyreRunning).toBeUndefined()
    expect(result.issuesThatMatter).toBeUndefined()
  })
})

describe('RaceOpponentFieldAnalysisSchema', () => {
  it('round-trips a fully-populated field analysis', () => {
    const input = {
      strengths: ['Strong fundraising'],
      weaknesses: ['Low name recognition'],
      opportunities: ['Opponent has no published water position'],
      threats: ['Opponent has union backing'],
      sources: [richSource],
      generatedAt: '2026-07-01T00:00:00.000Z',
    }
    const result = RaceOpponentFieldAnalysisSchema.parse(input)
    expect(result.strengths).toEqual(input.strengths)
    expect(result.sources).toEqual([richSource])
    expect(result.generatedAt).toBeInstanceOf(Date)
  })

  it('defaults sources to an empty array when omitted', () => {
    const result = RaceOpponentFieldAnalysisSchema.parse({
      strengths: [],
      weaknesses: [],
      opportunities: [],
      threats: [],
      generatedAt: null,
    })
    expect(result.sources).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import type {
  RaceOpponentResponse,
  RaceOpponentSummary,
} from 'gpApi/api-endpoints'
import {
  buildOpponentBrief,
  opponentsWithBrief,
  type OpponentBriefSection,
} from './opponentBriefContent'

type Opponent = RaceOpponentResponse['opponents'][number]

const fullSummary: RaceOpponentSummary = {
  opponentName: 'Graciela Guzman',
  overview: {
    text: 'The incumbent in a left-leaning seat.',
    sources: [{ sourceType: 'ballotpedia', sourceUrl: 'https://a.example' }],
  },
  background: {
    text: 'Two-term incumbent with party backing.',
    // Duplicate URL to prove overview+background sources are de-duped.
    sources: [{ sourceType: 'ballotpedia', sourceUrl: 'https://a.example' }],
  },
  keyPositions: [
    { label: 'Housing', detail: 'Backed developer credits.', sources: [] },
  ],
  generatedAt: null,
  threatTier: 'primary_threat',
  whyTheyMatter: 'Her air war is the real obstacle.',
  whatYouNeedToKnow: [
    { text: 'Voted YES on SB-1421.' },
    { text: 'Aligned with leadership.' },
  ],
  whereSoft: [{ text: 'No town hall in 14 months.', sources: undefined }],
  issueContrasts: [
    {
      issue: 'Affordable housing',
      salience: 'high',
      whyItMatters: 'Rent is up 31%.',
      opponentStance: 'Backed the developer credit.',
      opponentSources: [
        { sourceType: 'ballotpedia', sourceUrl: 'https://b.example' },
      ],
      candidateStance: 'Run on tenant protections.',
    },
  ],
}

const opponent = (overrides: Partial<Opponent> = {}): Opponent => ({
  opponentName: 'Graciela Guzman',
  party: 'Democrat',
  isIncumbent: true,
  threatTier: 'primary_threat',
  items: [],
  summary: fullSummary,
  ...overrides,
})

const kinds = (sections: OpponentBriefSection[]): string[] =>
  sections.map((section) => section.kind)

describe('buildOpponentBrief', () => {
  it('titles and snapshots from the roster identity, matching the page wording', () => {
    const brief = buildOpponentBrief(opponent())
    expect(brief.title).toBe('Opponent brief: Graciela Guzman')
    expect(brief.snapshot).toBe('Democrat · Incumbent · Main threat')
  })

  it('emits the page sections in order', () => {
    const brief = buildOpponentBrief(opponent())
    expect(kinds(brief.sections)).toEqual([
      'overview',
      'whyTheyMatter',
      'whatYouNeedToKnow',
      'whereSoft',
      'issueContrasts',
      'keyPositions',
    ])
  })

  it('de-dupes overview + background sources and keeps both paragraphs', () => {
    const brief = buildOpponentBrief(opponent())
    const overview = brief.sections.find((s) => s.kind === 'overview')
    expect(overview).toBeDefined()
    if (overview?.kind !== 'overview') throw new Error('expected overview')
    expect(overview.paragraphs).toHaveLength(2)
    expect(overview.sources).toHaveLength(1)
  })

  it('drops the salience label from issue contrasts (the page never renders it)', () => {
    const brief = buildOpponentBrief(opponent())
    const contrasts = brief.sections.find((s) => s.kind === 'issueContrasts')
    if (contrasts?.kind !== 'issueContrasts')
      throw new Error('expected issueContrasts')
    expect(contrasts.contrasts[0]).not.toHaveProperty('salience')
    expect(contrasts.contrasts[0]?.opponentStance).toBe(
      'Backed the developer credit.',
    )
  })

  it('never invents a finance section — no summary field feeds one', () => {
    const brief = buildOpponentBrief(opponent())
    expect(kinds(brief.sections)).not.toContain('finance')
    expect(JSON.stringify(brief).toLowerCase()).not.toContain('cash on hand')
  })

  it('omits sections whose data is empty or absent', () => {
    const brief = buildOpponentBrief(
      opponent({
        summary: {
          opponentName: 'Graciela Guzman',
          overview: { text: 'Just an overview.', sources: [] },
          background: null,
          keyPositions: [],
          generatedAt: null,
          whatYouNeedToKnow: [],
          whereSoft: [],
          issueContrasts: [],
        },
      }),
    )
    expect(kinds(brief.sections)).toEqual(['overview'])
  })

  it('snapshot falls back cleanly when identity fields are missing', () => {
    const brief = buildOpponentBrief(
      opponent({ party: null, isIncumbent: null, threatTier: undefined }),
    )
    expect(brief.snapshot).toBeNull()
  })
})

describe('opponentsWithBrief', () => {
  it('keeps only opponents that have a structured summary', () => {
    const withSummary = opponent()
    const rawOnly = opponent({ opponentName: 'Raw Only', summary: null })
    expect(opponentsWithBrief([withSummary, rawOnly])).toEqual([withSummary])
  })
})

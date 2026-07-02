import { describe, it, expect } from 'vitest'
import type {
  RaceOpponentFieldAnalysis,
  RaceOpponentResponse,
  RaceOpponentSummary,
} from 'gpApi/api-endpoints'
import {
  buildFieldAnalysisBrief,
  buildOpponentBrief,
  opponentsWithBrief,
  type OpponentBriefSection,
} from './opponentBriefContent'

type Opponent = RaceOpponentResponse['opponents'][number]

const v2Summary: RaceOpponentSummary = {
  opponentName: 'Graciela Guzman',
  overview: {
    text: 'The incumbent in a left-leaning seat.',
    sources: [
      {
        url: 'https://a.example',
        title: 'Candidate profile',
        publisher: 'Ballotpedia',
      },
    ],
  },
  whyTheyreRunning: { text: 'Ran on housing affordability last cycle.' },
  background: {
    text: 'Two-term incumbent with party backing.',
    sources: [
      {
        url: 'https://a.example',
        title: 'Candidate profile',
        publisher: 'Ballotpedia',
      },
    ],
  },
  issuesThatMatter: {
    items: ['Affordable housing', 'Transit expansion'],
    sources: [
      {
        url: 'https://b.example',
        title: 'Issue tracker',
        publisher: 'Ballotpedia',
      },
    ],
  },
  keyPositions: [],
  generatedAt: null,
  threatTier: 'primary_threat',
}

// A legacy-shaped summary: only the pre-v2 overview/background fields, plus
// the deprecated analytical fields a pre-ENG-10635 row might still carry.
const legacySummary: RaceOpponentSummary = {
  opponentName: 'Legacy Opponent',
  overview: {
    text: 'A legacy overview.',
    sources: [
      {
        url: 'https://c.example',
        title: 'Legacy source',
        publisher: 'Ballotpedia',
        sourceType: 'ballotpedia',
        sourceUrl: 'https://c.example',
      },
    ],
  },
  background: { text: 'A legacy background.', sources: [] },
  keyPositions: [
    { label: 'Housing', detail: 'Backed developer credits.', sources: [] },
  ],
  generatedAt: null,
  whyTheyMatter: 'Her air war is the real obstacle.',
  whatYouNeedToKnow: [{ text: 'Voted YES on SB-1421.' }],
  whereSoft: [{ text: 'No town hall in 14 months.' }],
  issueContrasts: [
    {
      issue: 'Affordable housing',
      salience: 'high',
      whyItMatters: 'Rent is up 31%.',
      opponentStance: 'Backed the developer credit.',
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
  summary: v2Summary,
  ...overrides,
})

const kinds = (sections: OpponentBriefSection[]): string[] =>
  sections.map((section) => section.kind)

const RETIRED_KINDS = [
  'whyTheyMatter',
  'whatYouNeedToKnow',
  'whereSoft',
  'issueContrasts',
  'keyPositions',
]

describe('buildOpponentBrief', () => {
  it('titles and snapshots from the roster identity, matching the page wording', () => {
    const brief = buildOpponentBrief(opponent())
    expect(brief.title).toBe('Opponent brief: Graciela Guzman')
    expect(brief.snapshot).toBe('Democrat · Incumbent · Main threat')
  })

  it('emits the v2 sections in the page order', () => {
    const brief = buildOpponentBrief(opponent())
    expect(kinds(brief.sections)).toEqual([
      'overview',
      'whyTheyreRunning',
      'background',
      'issuesThatMatter',
    ])
  })

  it('extracts the issues-that-matter bullet items', () => {
    const brief = buildOpponentBrief(opponent())
    const section = brief.sections.find((s) => s.kind === 'issuesThatMatter')
    if (section?.kind !== 'issuesThatMatter')
      throw new Error('expected issuesThatMatter')
    expect(section.items).toEqual(['Affordable housing', 'Transit expansion'])
  })

  it('never emits a retired section kind, even for a v2 summary', () => {
    const brief = buildOpponentBrief(opponent())
    RETIRED_KINDS.forEach((kind) => {
      expect(kinds(brief.sections)).not.toContain(kind)
    })
  })

  it('falls back to overview + background only for a legacy summary, dropping every retired field', () => {
    const brief = buildOpponentBrief(
      opponent({ opponentName: 'Legacy Opponent', summary: legacySummary }),
    )
    expect(kinds(brief.sections)).toEqual(['overview', 'background'])
    RETIRED_KINDS.forEach((kind) => {
      expect(kinds(brief.sections)).not.toContain(kind)
    })
  })

  it('renders the background section with no source line, matching the page', () => {
    const brief = buildOpponentBrief(opponent())
    const background = brief.sections.find((s) => s.kind === 'background')
    expect(background).toEqual({
      kind: 'background',
      text: 'Two-term incumbent with party backing.',
    })
  })

  it('includes a normalized website link in the overview line when present', () => {
    const brief = buildOpponentBrief(opponent({ websiteUrl: 'janerival.com' }))
    const overview = brief.sections.find((s) => s.kind === 'overview')
    if (overview?.kind !== 'overview') throw new Error('expected overview')
    expect(overview.websiteUrl).toBe('https://janerival.com')
  })

  it('keeps a fully-qualified website url as-is', () => {
    const brief = buildOpponentBrief(
      opponent({ websiteUrl: 'https://janerival.com' }),
    )
    const overview = brief.sections.find((s) => s.kind === 'overview')
    if (overview?.kind !== 'overview') throw new Error('expected overview')
    expect(overview.websiteUrl).toBe('https://janerival.com')
  })

  it('omits the website link when no websiteUrl is present', () => {
    const brief = buildOpponentBrief(opponent({ websiteUrl: null }))
    const overview = brief.sections.find((s) => s.kind === 'overview')
    if (overview?.kind !== 'overview') throw new Error('expected overview')
    expect(overview.websiteUrl).toBeNull()
  })

  it('formats source lines as "publisher — url", including a rich-only source with no sourceUrl key', () => {
    const brief = buildOpponentBrief(opponent())
    const overview = brief.sections.find((s) => s.kind === 'overview')
    if (overview?.kind !== 'overview') throw new Error('expected overview')
    expect(overview.sourceLines).toEqual(['Ballotpedia — https://a.example'])
  })

  it('formats a legacy source (carrying sourceType/sourceUrl) from its rich fields', () => {
    const brief = buildOpponentBrief(
      opponent({ opponentName: 'Legacy Opponent', summary: legacySummary }),
    )
    const overview = brief.sections.find((s) => s.kind === 'overview')
    if (overview?.kind !== 'overview') throw new Error('expected overview')
    expect(overview.sourceLines).toEqual(['Ballotpedia — https://c.example'])
  })

  it('de-dupes source lines by url within a section', () => {
    const brief = buildOpponentBrief(
      opponent({
        summary: {
          ...v2Summary,
          issuesThatMatter: {
            items: ['Affordable housing'],
            sources: [
              {
                url: 'https://b.example',
                title: 'Issue tracker',
                publisher: 'Ballotpedia',
              },
              {
                url: 'https://b.example',
                title: 'Issue tracker (dup)',
                publisher: 'Ballotpedia',
              },
            ],
          },
        },
      }),
    )
    const section = brief.sections.find((s) => s.kind === 'issuesThatMatter')
    if (section?.kind !== 'issuesThatMatter')
      throw new Error('expected issuesThatMatter')
    expect(section.sourceLines).toEqual(['Ballotpedia — https://b.example'])
  })

  it('never invents a finance section — no summary field feeds one', () => {
    const brief = buildOpponentBrief(opponent())
    expect(kinds(brief.sections)).not.toContain('finance')
    expect(JSON.stringify(brief).toLowerCase()).not.toContain('cash on hand')
  })

  it('omits sections whose data is absent', () => {
    const brief = buildOpponentBrief(
      opponent({
        summary: {
          opponentName: 'Graciela Guzman',
          overview: { text: 'Just an overview.', sources: [] },
          background: null,
          keyPositions: [],
          generatedAt: null,
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

describe('buildFieldAnalysisBrief', () => {
  const fieldAnalysis = (
    overrides: Partial<RaceOpponentFieldAnalysis> = {},
  ): RaceOpponentFieldAnalysis => ({
    strengths: ['Strong name ID'],
    weaknesses: ['Thin ground game'],
    opportunities: [],
    threats: [],
    sources: [],
    generatedAt: null,
    ...overrides,
  })

  it('returns null for a null/undefined fieldAnalysis', () => {
    expect(buildFieldAnalysisBrief(null)).toBeNull()
    expect(buildFieldAnalysisBrief(undefined)).toBeNull()
  })

  it('omits empty quadrants and keeps populated ones with their labels', () => {
    const brief = buildFieldAnalysisBrief(fieldAnalysis())
    expect(brief).toEqual({
      quadrants: [
        { label: 'Strengths', items: ['Strong name ID'] },
        { label: 'Weaknesses', items: ['Thin ground game'] },
      ],
    })
  })

  it('omits the whole block when fewer than 2 quadrants have content', () => {
    expect(
      buildFieldAnalysisBrief(
        fieldAnalysis({ weaknesses: [], strengths: ['Strong name ID'] }),
      ),
    ).toBeNull()
    expect(
      buildFieldAnalysisBrief(fieldAnalysis({ strengths: [], weaknesses: [] })),
    ).toBeNull()
  })

  it('includes all four quadrants when every one has content', () => {
    const brief = buildFieldAnalysisBrief(
      fieldAnalysis({
        opportunities: ['Open primary'],
        threats: ['A well-funded challenger'],
      }),
    )
    expect(brief?.quadrants.map((q) => q.label)).toEqual([
      'Strengths',
      'Weaknesses',
      'Opportunities',
      'Threats',
    ])
  })
})

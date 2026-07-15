import { describe, it, expect } from 'vitest'
import {
  OrdinanceAuthorityFindingSchema,
  OrdinanceComparableSchema,
  OrdinanceCurrentLawSummarySchema,
  OrdinanceLegislativeHistorySchema,
  OrdinancePresentComparablesSchema,
  OrdinancePresentDraftSchema,
} from './Ordinance.schema'

const source = {
  id: 'or-rs-181a',
  title: 'Or. Rev. Stat. § 181A.250',
  publisher: 'Oregon Revised Statutes',
  url: 'https://www.oregonlegislature.gov/bills_laws/ors/ors181A.html',
  kind: 'external',
  excerpt:
    'Permits municipal police agencies to operate public-space surveillance subject to local policy.',
}

describe('OrdinanceAuthorityFindingSchema', () => {
  const finding = {
    status: 'pass',
    headline: 'Pass. The council has authority to act.',
    explanation:
      'Local control of municipal police surveillance policy sits inside the council powers under Or. Rev. Stat. § 181A.250.',
    confirmation:
      'Green light. Nothing here needs a ballot measure. You can introduce this as an amendment to Chapter 12.',
    source,
  }

  it('parses a pass finding with a confirmation line', () => {
    const parsed = OrdinanceAuthorityFindingSchema.parse(finding)
    expect(parsed.status).toBe('pass')
    expect(parsed.headline).toBe('Pass. The council has authority to act.')
    expect(parsed.confirmation).toContain('Green light')
  })

  it('parses flag and attention statuses without a confirmation', () => {
    for (const status of ['flag', 'attention']) {
      const parsed = OrdinanceAuthorityFindingSchema.parse({
        status,
        headline: 'Needs review.',
        explanation: 'State law may preempt local siting rules.',
        source,
      })
      expect(parsed.status).toBe(status)
      expect(parsed.confirmation).toBeUndefined()
    }
  })

  it('rejects an unknown status and a missing source', () => {
    expect(
      OrdinanceAuthorityFindingSchema.safeParse({
        ...finding,
        status: 'success',
      }).success,
    ).toBe(false)
    const { source: _dropped, ...withoutSource } = finding
    expect(
      OrdinanceAuthorityFindingSchema.safeParse(withoutSource).success,
    ).toBe(false)
  })

  it('rejects a finding without a headline', () => {
    const { headline: _dropped, ...withoutHeadline } = finding
    expect(
      OrdinanceAuthorityFindingSchema.safeParse(withoutHeadline).success,
    ).toBe(false)
  })
})

describe('OrdinanceCurrentLawSummarySchema', () => {
  it('parses chapter, source, and both lists', () => {
    const parsed = OrdinanceCurrentLawSummarySchema.parse({
      chapterLabel: 'Chapter 12, Public Safety Surveillance',
      source,
      does: [
        {
          title: 'Police may install cameras in public rights-of-way',
          subtitle:
            'Cameras on poles, intersections, and city-owned facilities are explicitly allowed.',
        },
      ],
      gaps: [
        {
          title: 'No retention limit on footage',
          subtitle:
            'Recordings are kept indefinitely. No deletion schedule in code.',
        },
      ],
    })
    expect(parsed.does).toHaveLength(1)
    expect(parsed.gaps[0]?.title).toBe('No retention limit on footage')
  })

  it('allows empty lists, point subtitles, and source to be absent', () => {
    const parsed = OrdinanceCurrentLawSummarySchema.parse({
      chapterLabel: 'Chapter 12',
      does: [{ title: 'Cameras allowed' }],
      gaps: [],
    })
    expect(parsed.source).toBeUndefined()
    expect(parsed.does[0]?.subtitle).toBeUndefined()
    expect(parsed.gaps).toHaveLength(0)
  })
})

describe('OrdinanceLegislativeHistorySchema', () => {
  it('parses timeline entries with minutes excerpts', () => {
    const parsed = OrdinanceLegislativeHistorySchema.parse({
      chapterLabel: 'Chapter 12, Public Safety Surveillance',
      entries: [
        {
          year: 1998,
          label: 'Chapter 12 created',
          summary:
            'Council authorizes the first downtown camera pilot after a string of car break-ins.',
          minutesExcerpt:
            'We want this to be a tool the department uses with restraint, not a blank check for surveillance.',
          speaker: 'Councilor Alvarez',
          source,
        },
      ],
    })
    expect(parsed.entries[0]?.year).toBe(1998)
    expect(parsed.entries[0]?.speaker).toBe('Councilor Alvarez')
  })

  it('allows entries without excerpt, speaker, or source', () => {
    const parsed = OrdinanceLegislativeHistorySchema.parse({
      entries: [
        { year: 2017, label: 'Last amended', summary: 'Budget line only.' },
      ],
    })
    expect(parsed.chapterLabel).toBeUndefined()
    expect(parsed.entries[0]?.minutesExcerpt).toBeUndefined()
  })

  it('rejects a non-integer year', () => {
    expect(
      OrdinanceLegislativeHistorySchema.safeParse({
        entries: [{ year: 'nineties', label: 'x', summary: 'y' }],
      }).success,
    ).toBe(false)
  })
})

describe('OrdinancePresentComparablesSchema', () => {
  const repealed = {
    city: 'Lindel',
    state: 'Oregon',
    population: 31000,
    year: 2020,
    headline: 'Citywide facial-recognition cameras, repealed',
    quote:
      'All new public cameras shall be equipped with facial-recognition matching against a county watchlist.',
    outcome: 'Repealed in 2022 after an ACLU suit and resident pushback.',
    status: 'repealed',
    failureReason:
      'No siting criteria, no retention limit, no opt-out for sensitive locations.',
    source,
  }

  it('parses cards with intro and takeaway prose', () => {
    const parsed = OrdinancePresentComparablesSchema.parse({
      intro:
        'I pulled the closest comparable camera ordinances from peer cities.',
      comparables: [repealed],
      takeaway: 'Cities that paired expansion with guardrails held up.',
    })
    expect(parsed.comparables[0]?.failureReason).toContain('No siting criteria')
    expect(parsed.takeaway).toContain('guardrails')
  })

  it('keeps failureReason optional on the shared comparable shape', () => {
    const { failureReason: _dropped, ...passed } = repealed
    const parsed = OrdinanceComparableSchema.parse({
      ...passed,
      status: 'passed',
    })
    expect(parsed.failureReason).toBeUndefined()
  })

  it('rejects the prototype status vocabulary', () => {
    expect(
      OrdinancePresentComparablesSchema.safeParse({
        comparables: [{ ...repealed, status: 'success' }],
      }).success,
    ).toBe(false)
  })
})

describe('OrdinancePresentDraftSchema', () => {
  const draft = {
    title: 'Draft amendment to Chapter 12, Public Safety Surveillance',
    description:
      'Adds a 30-day retention limit, a siting standard, and an annual audit to the existing camera authority.',
    body: 'Section 12.20  Retention.\n\n(a) Recordings shall be deleted after thirty (30) days unless flagged for an active investigation.',
    sources: [source],
  }

  it('parses a full draft with a title, body, and sources', () => {
    const parsed = OrdinancePresentDraftSchema.parse(draft)
    expect(parsed.title).toContain('Chapter 12')
    expect(parsed.body).toContain('thirty (30) days')
    expect(parsed.sources?.[0]?.id).toBe('or-rs-181a')
  })

  it('allows description and sources to be absent', () => {
    const parsed = OrdinancePresentDraftSchema.parse({
      title: 'Draft resolution on Elm and 6th stormwater remediation',
      body: 'Resolution No. [____]\n\nSection 1. Findings.',
    })
    expect(parsed.description).toBeUndefined()
    expect(parsed.sources).toBeUndefined()
  })

  it('preserves {-old-}{+new+} redline markup in the body verbatim', () => {
    const parsed = OrdinancePresentDraftSchema.parse({
      title: 'Redline of Chapter 18, Residential Rentals',
      body: 'Section 18.40  {-Residential rentals generally.-}{+Short-term rental registration.+}',
    })
    expect(parsed.body).toContain('{+Short-term rental registration.+}')
  })

  it('rejects a draft with a missing or empty title or body', () => {
    const { body: _b, ...withoutBody } = draft
    expect(OrdinancePresentDraftSchema.safeParse(withoutBody).success).toBe(
      false,
    )
    expect(
      OrdinancePresentDraftSchema.safeParse({ ...draft, body: '' }).success,
    ).toBe(false)
    expect(
      OrdinancePresentDraftSchema.safeParse({ ...draft, title: '' }).success,
    ).toBe(false)
  })
})

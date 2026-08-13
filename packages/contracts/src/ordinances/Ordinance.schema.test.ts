import { describe, it, expect } from 'vitest'
import {
  OrdinanceAuthorityFindingSchema,
  OrdinanceComparableSchema,
  OrdinanceCurrentLawSummarySchema,
  OrdinanceLegislativeHistorySchema,
  OrdinancePresentComparablesSchema,
  OrdinancePresentDraftSchema,
  OrdinanceQualityIterationsResponseSchema,
  OrdinanceQualityIterationSummarySchema,
  OrdinanceQualityLoopPhaseSchema,
  OrdinanceQualityLoopSchema,
  OrdinanceSchema,
  OrdinanceSummarySchema,
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

describe('OrdinanceQualityLoopSchema', () => {
  const running = {
    status: 'running',
    phase: 'checking',
    passNumber: 2,
    maxPasses: 4,
    updatedAt: '2026-07-17T18:00:00.000Z',
  }

  it('parses a running loop with a phase', () => {
    const parsed = OrdinanceQualityLoopSchema.parse(running)
    expect(parsed.status).toBe('running')
    expect(parsed.phase).toBe('checking')
    expect(parsed.passNumber).toBe(2)
    expect(parsed.maxPasses).toBe(4)
  })

  it('parses a terminal loop with a null phase', () => {
    const parsed = OrdinanceQualityLoopSchema.parse({
      ...running,
      status: 'converged',
      phase: null,
    })
    expect(parsed.status).toBe('converged')
    expect(parsed.phase).toBeNull()
  })

  it('accepts every terminal status the loop can end in', () => {
    for (const status of [
      'stopped_max_iterations',
      'stopped_not_improving',
      'superseded_by_edit',
      'cancelled',
      'failed',
    ]) {
      expect(
        OrdinanceQualityLoopSchema.safeParse({
          ...running,
          status,
          phase: null,
        }).success,
      ).toBe(true)
    }
  })

  it('rejects an unknown status, unknown phase, and missing passNumber', () => {
    expect(
      OrdinanceQualityLoopSchema.safeParse({ ...running, status: 'paused' })
        .success,
    ).toBe(false)
    expect(
      OrdinanceQualityLoopSchema.safeParse({ ...running, phase: 'grading' })
        .success,
    ).toBe(false)
    const { passNumber: _dropped, ...withoutPass } = running
    expect(OrdinanceQualityLoopSchema.safeParse(withoutPass).success).toBe(
      false,
    )
  })

  it('rejects a non-integer passNumber', () => {
    expect(
      OrdinanceQualityLoopSchema.safeParse({ ...running, passNumber: 1.5 })
        .success,
    ).toBe(false)
  })

  it('limits the phase vocabulary to checking and revising', () => {
    expect(OrdinanceQualityLoopPhaseSchema.parse('revising')).toBe('revising')
    expect(OrdinanceQualityLoopPhaseSchema.safeParse('qc').success).toBe(false)
  })
})

describe('OrdinanceSchema.qualityLoop', () => {
  const ordinance = {
    id: 'ord-1',
    slug: 'ord-slug-1',
    electedOfficeId: 'eo-1',
    status: 'draft',
    seedType: 'new',
    issueSlug: null,
    sourceLink: null,
    goalText: null,
    existingLaw: null,
    clarify: null,
    clarifyAnswers: null,
    authority: null,
    comparables: null,
    draftTitle: 'Camera retention amendment',
    draftBody: 'Section 1. Findings.',
    draftSources: null,
    qualityReport: null,
    qualityRunStatus: 'idle',
    research: null,
    scratchpad: null,
    lastViewedStep: null,
    createdAt: '2026-07-17T17:00:00.000Z',
    updatedAt: '2026-07-17T18:00:00.000Z',
  }

  it('parses with a running loop and with no loop at all', () => {
    const withLoop = OrdinanceSchema.parse({
      ...ordinance,
      qualityLoop: {
        status: 'running',
        phase: 'revising',
        passNumber: 1,
        maxPasses: 4,
        updatedAt: '2026-07-17T18:00:00.000Z',
      },
    })
    expect(withLoop.qualityLoop?.phase).toBe('revising')
    const withoutLoop = OrdinanceSchema.parse({
      ...ordinance,
      qualityLoop: null,
    })
    expect(withoutLoop.qualityLoop).toBeNull()
  })

  it('rejects an ordinance missing the qualityLoop field', () => {
    expect(OrdinanceSchema.safeParse(ordinance).success).toBe(false)
  })
})

describe('OrdinanceSummarySchema.qualityLoopStatus', () => {
  const summary = {
    id: 'ord-1',
    slug: 'ord-slug-1',
    status: 'draft',
    seedType: 'new',
    draftTitle: 'Camera retention amendment',
    goalText: null,
    lastViewedStep: null,
    createdAt: '2026-07-17T17:00:00.000Z',
    updatedAt: '2026-07-17T18:00:00.000Z',
  }

  it('parses running and null loop statuses', () => {
    expect(
      OrdinanceSummarySchema.parse({
        ...summary,
        qualityLoopStatus: 'running',
      }).qualityLoopStatus,
    ).toBe('running')
    expect(
      OrdinanceSummarySchema.parse({ ...summary, qualityLoopStatus: null })
        .qualityLoopStatus,
    ).toBeNull()
  })

  it('rejects an unknown loop status', () => {
    expect(
      OrdinanceSummarySchema.safeParse({
        ...summary,
        qualityLoopStatus: 'paused',
      }).success,
    ).toBe(false)
  })
})

describe('OrdinanceQualityIterationSummarySchema', () => {
  const iteration = {
    iteration: 0,
    flaggedCheckIds: ['legal_conflict', 'clarity'],
    report: null,
    draftTitle: 'Camera retention amendment',
    draftBody: 'Section 1. Recordings shall be deleted after thirty days.',
    draftSources: [{ id: 'gs-160a', title: 'N.C.G.S. § 160A-174' }],
    revisedTitle: 'Camera retention amendment (revised)',
    revisedBody: 'Section 1. Recordings shall be deleted after 30 days.',
    revisionNotes: [
      { checkId: 'clarity', note: 'Spelled the retention window as 30 days.' },
    ],
    createdAt: '2026-07-17T18:00:00.000Z',
  }

  it('parses a revised iteration with per-check notes', () => {
    const parsed = OrdinanceQualityIterationSummarySchema.parse(iteration)
    expect(parsed.flaggedCheckIds).toEqual(['legal_conflict', 'clarity'])
    expect(parsed.revisionNotes?.[0]?.checkId).toBe('clarity')
  })

  it('parses a graded-only iteration with null revision fields', () => {
    const parsed = OrdinanceQualityIterationSummarySchema.parse({
      ...iteration,
      revisedTitle: null,
      revisedBody: null,
      revisionNotes: null,
    })
    expect(parsed.revisedTitle).toBeNull()
    expect(parsed.revisionNotes).toBeNull()
  })

  it('rejects a missing iteration number and a malformed note', () => {
    const { iteration: _dropped, ...withoutIteration } = iteration
    expect(
      OrdinanceQualityIterationSummarySchema.safeParse(withoutIteration)
        .success,
    ).toBe(false)
    expect(
      OrdinanceQualityIterationSummarySchema.safeParse({
        ...iteration,
        revisionNotes: [{ note: 'missing checkId' }],
      }).success,
    ).toBe(false)
  })
})

describe('OrdinanceQualityIterationsResponseSchema', () => {
  it('parses a run with iterations and an empty never-ran response', () => {
    const parsed = OrdinanceQualityIterationsResponseSchema.parse({
      loopRunId: 'run-1',
      iterations: [
        {
          iteration: 0,
          flaggedCheckIds: [],
          report: null,
          draftTitle: 'Title',
          draftBody: 'Body',
          draftSources: null,
          revisedTitle: null,
          revisedBody: null,
          revisionNotes: null,
          createdAt: '2026-07-17T18:00:00.000Z',
        },
      ],
    })
    expect(parsed.loopRunId).toBe('run-1')
    expect(parsed.iterations).toHaveLength(1)
    const empty = OrdinanceQualityIterationsResponseSchema.parse({
      loopRunId: null,
      iterations: [],
    })
    expect(empty.iterations).toHaveLength(0)
  })

  it('rejects a response missing loopRunId', () => {
    expect(
      OrdinanceQualityIterationsResponseSchema.safeParse({ iterations: [] })
        .success,
    ).toBe(false)
  })
})

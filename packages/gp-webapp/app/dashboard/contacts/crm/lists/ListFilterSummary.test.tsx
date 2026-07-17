import { describe, expect, it } from 'vitest'
import { buildFilterSummary } from './ListFilterSummary'
import type { SegmentResponse } from '../shared/contacts-types'

const baseSegment = (
  overrides: Partial<SegmentResponse> = {},
): SegmentResponse => ({
  id: 1,
  name: 'Test list',
  ...overrides,
})

describe('buildFilterSummary — demographic-only filters', () => {
  it('renders the everyone fallback when nothing is set', () => {
    expect(buildFilterSummary(baseSegment(), false)).toBe(
      'Everyone in your file — no filters applied.',
    )
  })

  it('renders a clause per matched demographic field', () => {
    const summary = buildFilterSummary(
      baseSegment({ genderFemale: true, age18_25: true, age25_35: true }),
      false,
    )
    expect(summary).toContain('Gender: Female')
    expect(summary).toContain('Age: 18-25 or 25-35')
  })

  it('excludes political party for an elected official (Serve never shows party)', () => {
    const summary = buildFilterSummary(
      baseSegment({ partyDemocrat: true }),
      true,
    )
    expect(summary).not.toContain('Democrat')
    expect(summary).not.toContain('Political Party')
  })

  it('includes political party for a Win (non-elected-official) list', () => {
    const summary = buildFilterSummary(
      baseSegment({ partyDemocrat: true }),
      false,
    )
    expect(summary).toContain('Political Party: Democrat')
  })

  it('renders language codes and income ranges via their label maps', () => {
    const summary = buildFilterSummary(
      baseSegment({
        languageCodes: ['en', 'es'],
        incomeRanges: ['Under $25k'],
        incomeUnknown: true,
      }),
      false,
    )
    expect(summary).toContain('Language: English or Spanish')
    expect(summary).toContain('Household Income: Under $25k or Unknown')
  })

  it('renders support status via the shared label map', () => {
    const summary = buildFilterSummary(
      baseSegment({ supportStatus: ['supporter', 'unknown'] }),
      false,
    )
    expect(summary).toContain('Support Status: Supporter or Support Unknown')
  })

  it('renders the saved search term', () => {
    const summary = buildFilterSummary(
      baseSegment({ search: 'Main Street' }),
      false,
    )
    expect(summary).toContain('Matching search "Main Street"')
  })
})

describe('buildFilterSummary — activity-only filters', () => {
  it('covers every activity channel label', () => {
    const summary = buildFilterSummary(
      baseSegment({
        activityConditions: [
          { outreachType: 'text', outreachId: null, actions: [] },
          { outreachType: 'doorKnocking', outreachId: null, actions: [] },
          { outreachType: 'robocall', outreachId: null, actions: [] },
        ],
      }),
      false,
    )
    expect(summary).toContain('Text — Any text campaign')
    expect(summary).toContain('Door Knocking — Any door knocking campaign')
    expect(summary).toContain('Robocall — Any robocall campaign')
  })

  it('covers every action label and a specific-campaign reference', () => {
    const summary = buildFilterSummary(
      baseSegment({
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: 55,
            actions: ['no_response', 'opted_out'],
          },
          {
            outreachType: 'doorKnocking',
            outreachId: null,
            actions: ['support_yes', 'support_unsure', 'support_no'],
          },
          {
            outreachType: 'robocall',
            outreachId: null,
            actions: ['answered', 'voicemail_left', 'no_answer'],
          },
        ],
      }),
      false,
    )
    expect(summary).toContain(
      'Text — a specific campaign (No Response, Opted Out)',
    )
    expect(summary).toContain(
      'Door Knocking — Any door knocking campaign (Support: Yes, Support: Unsure, Support: No)',
    )
    expect(summary).toContain(
      'Robocall — Any robocall campaign (Answered, Voicemail Left, No Answer)',
    )
  })
})

describe('buildFilterSummary — mixed filters', () => {
  it('joins demographic and activity clauses together', () => {
    const summary = buildFilterSummary(
      baseSegment({
        age18_25: true,
        age25_35: true,
        activityConditions: [
          { outreachType: 'text', outreachId: 55, actions: ['no_response'] },
        ],
      }),
      false,
    )
    expect(summary).toContain('Age: 18-25 or 25-35')
    expect(summary).toContain('Text — a specific campaign (No Response)')
    expect(summary.split(' · ')).toHaveLength(2)
  })
})

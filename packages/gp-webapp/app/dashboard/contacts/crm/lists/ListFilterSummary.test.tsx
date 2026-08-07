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

  it('renders a sentence-case clause per matched demographic field', () => {
    const summary = buildFilterSummary(
      baseSegment({ genderFemale: true, age18_24: true, age25_34: true }),
      false,
    )
    expect(summary).toBe('Gender Female and Age 18-24 or 25-34.')
  })

  // Lists saved before ENG-10752 carry the retired overlapping age keys;
  // the summary must keep describing them with their original labels.
  it('labels legacy age keys on lists saved before the range split', () => {
    const summary = buildFilterSummary(
      baseSegment({ age18_25: true, age50Plus: true }),
      false,
    )
    expect(summary).toBe('Age 18-25 or 50+.')
  })

  it('excludes political party for an elected official (Serve never shows party)', () => {
    const summary = buildFilterSummary(
      baseSegment({ partyDemocrat: true }),
      true,
    )
    expect(summary).not.toContain('Democrat')
    expect(summary).not.toContain('Political party')
  })

  it('includes political party for a Win (non-elected-official) list', () => {
    const summary = buildFilterSummary(
      baseSegment({ partyDemocrat: true }),
      false,
    )
    expect(summary).toBe('Political party Democrat.')
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
    expect(summary).toContain('Language English or Spanish')
    expect(summary).toContain('Income ranges include Under $25k or Unknown')
  })

  it('renders support status via the shared label map', () => {
    const summary = buildFilterSummary(
      baseSegment({ supportStatus: ['supporter', 'unknown'] }),
      false,
    )
    expect(summary).toBe('Support status Supporter or Support Unknown.')
  })

  // ENG-10837: undecided/refused extend the shared vocabulary (override-only
  // values), matching the profile's 5-value support status.
  it('renders the undecided and refused support status values', () => {
    const summary = buildFilterSummary(
      baseSegment({ supportStatus: ['undecided', 'refused'] }),
      false,
    )
    expect(summary).toBe('Support status Undecided or Refused.')
  })

  it('renders the saved search term', () => {
    const summary = buildFilterSummary(
      baseSegment({ search: 'Main Street' }),
      false,
    )
    expect(summary).toBe('matching search "Main Street".')
  })
})

// ENG-10839: Contacts Made gets its own "with N or M prior contacts made"
// clause rather than the generic "{Label} {value}" phrasing, and is Win-only.
describe('buildFilterSummary — contacts-made filter', () => {
  it('renders a single selected bucket', () => {
    const summary = buildFilterSummary(
      baseSegment({ contactsMade2: true }),
      false,
    )
    expect(summary).toBe('with 2 prior contacts made.')
  })

  it('renders a mixed "0 + a bucket" selection', () => {
    const summary = buildFilterSummary(
      baseSegment({ contactsMade0: true, contactsMade3: true }),
      false,
    )
    expect(summary).toBe('with 0 or 3 prior contacts made.')
  })

  it('renders the 5+ bucket label', () => {
    const summary = buildFilterSummary(
      baseSegment({ contactsMade5Plus: true }),
      false,
    )
    expect(summary).toBe('with 5+ prior contacts made.')
  })

  it('excludes contacts made for an elected official (Win-only)', () => {
    const summary = buildFilterSummary(
      baseSegment({ contactsMade2: true }),
      true,
    )
    expect(summary).not.toContain('contacts made')
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
    expect(summary).toContain('Text activity from any text campaign')
    expect(summary).toContain(
      'Door Knocking activity from any door knocking campaign',
    )
    expect(summary).toContain('Robocall activity from any robocall campaign')
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
      'Text activity from a specific campaign with outcome No Response or Opted Out',
    )
    expect(summary).toContain(
      'Door Knocking activity from any door knocking campaign with outcome Support: Yes or Support: Unsure or Support: No',
    )
    expect(summary).toContain(
      'Robocall activity from any robocall campaign with outcome Answered or Voicemail Left or No Answer',
    )
  })
})

describe('buildFilterSummary — mixed filters', () => {
  it('joins clauses as one comma-and sentence', () => {
    const summary = buildFilterSummary(
      baseSegment({
        age18_25: true,
        age25_35: true,
        genderFemale: true,
        activityConditions: [
          { outreachType: 'text', outreachId: 55, actions: ['no_response'] },
        ],
      }),
      false,
    )
    expect(summary).toBe(
      'Gender Female, Age 18-25 or 25-35, and Text activity from a specific campaign with outcome No Response.',
    )
  })
})

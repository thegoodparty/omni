import { describe, expect, it } from 'vitest'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import {
  savedListFilterKeys,
  savedListUnshadeableCriteria,
  withoutUnshadeableCriteria,
} from './savedListFilters'

const list = (over: Partial<SegmentResponse>): SegmentResponse =>
  ({ id: 1, name: 'Saved list', ...over }) as SegmentResponse

describe('savedListFilterKeys', () => {
  it('keeps the boolean pills a list was saved with', () => {
    expect(
      savedListFilterKeys(
        list({ partyDemocrat: true, partyRepublican: false }),
      ),
    ).toEqual({ partyDemocrat: true, partyRepublican: false })
  })

  it('re-expands the ranges the backend stores as string arrays', () => {
    expect(
      savedListFilterKeys(
        list({ incomeRanges: ['$25k - $35k'], languageCodes: ['es'] }),
      ),
    ).toMatchObject({ income25kTo35k: true, languageSpanish: true })
  })

  // The reported defect. A "persuasion" list is narrowed by support status,
  // which is a column the pack has no plane for — so it used to arrive here as
  // an empty draft, the preview counted the whole district, and
  // `unpreviewableFilterKeys` had no key to disclose because the criterion was
  // dropped before it ever saw it.
  it('marks a support-status list rather than dropping it to nothing', () => {
    expect(savedListFilterKeys(list({ supportStatus: ['undecided'] }))).toEqual(
      { supportStatus: true },
    )
  })

  it('marks activity conditions and precincts the same way', () => {
    expect(
      savedListFilterKeys(
        list({
          activityConditions: [
            { outreachType: 'text', outreachId: null, actions: ['responded'] },
          ],
          precincts: ['Sangamon|14'],
        }),
      ),
    ).toEqual({ activityConditions: true, precincts: true })
  })

  // An empty array is not a criterion, and marking one would print a
  // disclosure about a filter the list does not apply.
  it('marks nothing for a list carrying empty criteria arrays', () => {
    expect(
      savedListFilterKeys(
        list({ supportStatus: [], activityConditions: [], precincts: [] }),
      ),
    ).toEqual({})
  })
})

describe('savedListUnshadeableCriteria', () => {
  // What the pack cannot shade, gp-api can still evaluate exactly — the
  // address preview runs the knock's own resolution. So these travel with the
  // preview request rather than being dropped with the rest of the draft.
  it('carries the criteria the draft cannot, normalised for the wire', () => {
    expect(
      savedListUnshadeableCriteria(
        list({
          supportStatus: ['undecided', 'unknown'],
          precincts: ['Sangamon|14'],
          activityConditions: [
            {
              outreachType: 'text',
              outreachId: 12,
              actions: ['responded'],
              // Prisma relation rows carry these; the request grammar does not.
              id: 'row-1',
              voterFileFilterId: 4,
            } as never,
          ],
        }),
      ),
    ).toEqual({
      supportStatus: ['undecided', 'unknown'],
      precincts: ['Sangamon|14'],
      activityConditions: [
        { outreachType: 'text', outreachId: 12, actions: ['responded'] },
      ],
    })
  })

  it('omits a criterion the list does not carry, and answers {} for no list', () => {
    expect(savedListUnshadeableCriteria(list({ supportStatus: [] }))).toEqual(
      {},
    )
    expect(savedListUnshadeableCriteria(undefined)).toEqual({})
  })
})

describe('withoutUnshadeableCriteria', () => {
  // Editing a pill leaves the named list behind, so the list's own
  // support-status and activity clauses leave with it: a new list saved from
  // the edited draft cannot carry them (`transformVoterFileFiltersForBackend`
  // only speaks option keys), and a disclosure about a filter the new list
  // will not apply is a false alarm.
  it('strips the marks so an edited draft stops claiming the list’s clauses', () => {
    expect(
      withoutUnshadeableCriteria({
        partyDemocrat: true,
        supportStatus: true,
        activityConditions: true,
        precincts: true,
      }),
    ).toEqual({ partyDemocrat: true })
  })
})

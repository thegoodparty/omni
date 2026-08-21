import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { DecodedPack } from './packDecoder'
import type { PolygonStats } from './filterEngine'
import TurfDetailsDrawer from './TurfDetailsDrawer'

// The sheet's own rendering has its own suite. Stubbed to the four values this
// seam computes, so a change in what the drawer DERIVES fails here rather than
// somewhere downstream of a hundred lines of layout.
const sheetProps: {
  current: {
    listStats: PolygonStats | null
    listStatsPending: boolean
    unpreviewableKeys: string[]
  } | null
} = { current: null }
vi.mock('./TurfDetailsSheet', () => ({
  __esModule: true,
  default: (props: {
    listStats: PolygonStats | null
    listStatsPending: boolean
    unpreviewableKeys: string[]
  }) => {
    sheetProps.current = props
    return <div data-testid="details-sheet" />
  },
}))

// 4 people over 2 dots, matching the page suite's fixture: person 0 is a
// Democrat and persons 1-2 are unknown-party, all three at dot 0 inside the
// ring; person 3 sits at dot 1 outside it. So the ring holds 3 people with no
// filters and 1 once the list's own party filter is applied — the difference
// this drawer exists to report.
//
// The income and language planes exist for the re-expansion tests below, and
// are laid out so each filter alone leaves 2 of the 3 in-ring people and the
// two together leave 1. Three distinguishable counts, so a dropped filter
// reads as a different number rather than as a coincidence.
const pack = {
  manifest: {
    version: 1,
    generatedAt: '2026-07-21T12:00:00Z',
    counts: { people: 4, households: 3, dots: 2 },
    dims: [
      { key: 'canvassStatus', values: ['unknown', 'not_home', 'supporter'] },
      { key: 'party', values: ['Unknown', 'Democratic', 'Republican'] },
      { key: 'income', values: ['Unknown', '$50k - $75k', '$200k+'] },
      { key: 'language', values: ['English', 'Spanish', 'Other'] },
    ],
    arrays: [],
  },
  positions: new Float32Array([-87.65, 41.9, -87.66, 41.91]),
  personToHousehold: new Uint32Array([0, 0, 1, 2]),
  householdToDot: new Uint32Array([0, 0, 1]),
  dimPlanes: new Map([
    ['canvassStatus', new Uint8Array([2, 0, 0, 0])],
    ['party', new Uint8Array([1, 2, 0, 0])],
    ['income', new Uint8Array([1, 1, 0, 1])],
    ['language', new Uint8Array([1, 0, 1, 1])],
  ]),
} as unknown as DecodedPack

const turf: DoorKnockingTurf = {
  id: 1,
  voterFileFilterId: 7,
  name: 'Elm St & 5th',
  color: '#2563eb',
  geoPoly: {
    type: 'Polygon',
    coordinates: [
      [
        [-87.655, 41.895],
        [-87.645, 41.895],
        [-87.645, 41.905],
        [-87.655, 41.905],
        [-87.655, 41.895],
      ],
    ],
  },
  locked: false,
  doorCount: null,
  peopleCount: null,
  loggedCount: null,
  completedAt: null,
  archivedAt: null,
  createdAt: new Date('2026-07-21T00:00:00Z'),
  updatedAt: new Date('2026-07-21T00:00:00Z'),
}

const renderDrawer = (
  savedLists: SegmentResponse[],
  overrides: { pack?: DecodedPack | null; packPending?: boolean } = {},
) => {
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    data: savedLists,
  })
  return render(
    <TurfDetailsDrawer
      turf={turf}
      pack={overrides.pack === undefined ? pack : overrides.pack}
      packPending={overrides.packPending ?? false}
      onClose={vi.fn()}
      onDeleted={vi.fn()}
    />,
  )
}

describe('TurfDetailsDrawer seam', () => {
  beforeEach(() => {
    testQueryClient.clear()
    sheetProps.current = null
  })

  // The whole reason this computation moved into the drawer: it is the list's
  // audience inside its ring, not the ring's population, and nothing outside
  // this surface reads it.
  it('counts the list’s own filters inside the polygon, not everyone in it', async () => {
    renderDrawer([{ id: 7, partyDemocrat: true }])

    await waitFor(() => expect(sheetProps.current?.listStats).not.toBeNull())
    expect(sheetProps.current?.listStats?.people).toBe(1)
    expect(sheetProps.current?.listStatsPending).toBe(false)
  })

  // `savedListFilterKeys(undefined)` is `{}`, which polygonStats reads as "no
  // filters" and answers with all 3 people in the ring. A list deleted in the
  // CRM must produce no stats instead — the plausible wrong answer is the one
  // worth a test.
  it('yields no stats for a list that is gone from the CRM', async () => {
    renderDrawer([])

    await waitFor(() =>
      expect(screen.getByTestId('details-sheet')).toBeTruthy(),
    )
    await waitFor(() =>
      expect(sheetProps.current?.listStatsPending).toBe(false),
    )
    expect(sheetProps.current?.listStats).toBeNull()
  })

  // Either input still in flight leaves the stats null for a reason that
  // resolves itself, and the drawer must be told which of the two it is.
  it('reports pending while the pack has yet to arrive', async () => {
    renderDrawer([{ id: 7 }], { pack: null, packPending: true })

    await waitFor(() => expect(sheetProps.current?.listStatsPending).toBe(true))
    expect(sheetProps.current?.listStats).toBeNull()
  })

  // Income and language are the two filters the backend does NOT store as
  // booleans, so `savedListFilterKeys` has to re-expand them through a reversed
  // map before the pack can see them at all. The failure is silent and it is
  // one-directional — a broken map drops the filter and the list looks like it
  // targets MORE people than it does, which is the direction nobody reports.
  // Asserting 2 rather than 3 is the whole point: 3 is the answer for a ring
  // with no filters applied.
  it('re-expands a list’s income ranges before counting', async () => {
    renderDrawer([{ id: 7, incomeRanges: ['$50k - $75k'] } as SegmentResponse])

    await waitFor(() => expect(sheetProps.current?.listStats).not.toBeNull())
    expect(sheetProps.current?.listStats?.people).toBe(2)
  })

  // Language round-trips through the key rather than the code, which is the
  // part worth pinning: the list stores 'es', the pack bucket is 'Spanish', and
  // nothing would line those two up if the reversal stopped going via
  // `languageSpanish`.
  it('re-expands a list’s language codes before counting', async () => {
    renderDrawer([{ id: 7, languageCodes: ['es'] } as SegmentResponse])

    await waitFor(() => expect(sheetProps.current?.listStats).not.toBeNull())
    expect(sheetProps.current?.listStats?.people).toBe(2)
  })

  // Both at once, because a list carrying two re-expanded filters is where a
  // reversal that returns the right keys but loses one of them still reads as
  // plausible on the single-filter cases above.
  it('applies both re-expanded filters together', async () => {
    renderDrawer([
      {
        id: 7,
        incomeRanges: ['$50k - $75k'],
        languageCodes: ['es'],
      } as SegmentResponse,
    ])

    await waitFor(() => expect(sheetProps.current?.listStats).not.toBeNull())
    expect(sheetProps.current?.listStats?.people).toBe(1)
  })

  // The saved list's unshadeable filters, not the create flow's draft — which
  // is empty whenever this drawer is open, so reading that value would have
  // disclosed nothing on every list that needed it.
  it('discloses the saved list’s unshadeable filters', async () => {
    renderDrawer([{ id: 7, age65Plus: true }])

    await waitFor(() =>
      expect(sheetProps.current?.unpreviewableKeys).toContain('age65Plus'),
    )
  })
})

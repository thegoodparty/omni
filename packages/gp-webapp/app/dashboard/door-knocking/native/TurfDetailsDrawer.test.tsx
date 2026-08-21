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
const pack = {
  manifest: {
    version: 1,
    generatedAt: '2026-07-21T12:00:00Z',
    counts: { people: 4, households: 3, dots: 2 },
    dims: [
      { key: 'canvassStatus', values: ['unknown', 'not_home', 'supporter'] },
      { key: 'party', values: ['Unknown', 'Democratic', 'Republican'] },
    ],
    arrays: [],
  },
  positions: new Float32Array([-87.65, 41.9, -87.66, 41.91]),
  personToHousehold: new Uint32Array([0, 0, 1, 2]),
  householdToDot: new Uint32Array([0, 0, 1]),
  dimPlanes: new Map([
    ['canvassStatus', new Uint8Array([2, 0, 0, 0])],
    ['party', new Uint8Array([1, 2, 0, 0])],
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

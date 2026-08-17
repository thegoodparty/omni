import { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import NativeDoorKnockingPage from './NativeDoorKnockingPage'

// 4 people over 2 dots. Person 0 is a Democratic supporter and persons 1-2 are
// unknown, all three at dot 0; person 3 is unknown at dot 1, outside the saved
// turf below. So the district reads 3 unknown / 1 supporter and the turf reads
// 2 unknown / 1 supporter — the two numbers the rail has to tell apart — while
// the party plane gives a saved list something of its own to narrow by.
// A triangle around both dots, tapped one vertex at a time, so the draw step
// can be walked the way a canvasser walks it: the stub reports each tap the
// way the canvas does, including its three-point gate on the ring.
const { drawSession, packFixture } = vi.hoisted(() => ({
  drawSession: {
    placed: [] as Array<[number, number]>,
    taps: [
      [-87.67, 41.885],
      [-87.63, 41.885],
      [-87.65, 41.95],
    ] as Array<[number, number]>,
  },
  packFixture: {
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
  },
}))

vi.mock('./useVoterPack', () => ({
  voterPackQueryOptions: {
    queryKey: ['door-knocking-pack'],
    queryFn: async () => packFixture,
  },
}))
// deck.gl and maplibre don't run in jsdom. The stub reports the filtered
// people count so a chip click can be checked against the map, not just
// against the rail's own copy.
vi.mock('./VoterMapCanvas', () => ({
  __esModule: true,
  default: ({
    filterResult,
    initialZoom,
    onPolygonChange,
    onDrawPointCount,
  }: {
    filterResult: { people: number }
    initialZoom?: number
    onPolygonChange: (ring: Array<[number, number]> | null) => void
    onDrawPointCount?: (count: number) => void
  }) => (
    <div
      data-testid="voter-map"
      data-people={String(filterResult.people)}
      data-initial-zoom={String(initialZoom)}
    >
      <button
        type="button"
        onClick={() => {
          const tap = drawSession.taps[drawSession.placed.length]
          if (!tap) return
          const next = [...drawSession.placed, tap]
          drawSession.placed = next
          onDrawPointCount?.(next.length)
          // The canvas's own gate: a ring exists from three points, and the
          // shape closes itself rather than waiting for a finish gesture.
          onPolygonChange(next.length >= 3 ? next : null)
        }}
      >
        tap the map
      </button>
    </div>
  ),
}))
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('app/dashboard/shared/useDistrictResolution', () => ({
  useDistrictResolution: () => ({ isUnresolvable: false }),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => null,
}))
vi.mock('./useWalkSession', () => ({
  useWalkSession: () => ({
    turf: null,
    start: vi.fn(),
    end: vi.fn(),
    recordDoor: vi.fn(),
  }),
}))

// A ring around dot 0 only, so person 3 falls outside the list.
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
  createdAt: new Date('2026-07-21T00:00:00Z'),
  updatedAt: new Date('2026-07-21T00:00:00Z'),
}

const chip = (label: string, count: number) =>
  screen.getByRole('button', { name: new RegExp(`${label}\\s*${count}`) })

// The turf points at saved filter 7; passing one here is what exercises the
// list's own filters, as opposed to only its polygon.
const renderPage = (savedLists: SegmentResponse[] = []) => {
  api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [turf] })
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    data: savedLists,
  })
  return render(
    <NativeDoorKnockingPage
      pathname="/dashboard/door-knocking"
      campaign={null}
    />,
  )
}

const selectTurf = async () => {
  await waitFor(() =>
    expect(screen.getByText('Elm St & 5th')).toBeInTheDocument(),
  )
  fireEvent.click(screen.getByText('Elm St & 5th'))
  await waitFor(() =>
    expect(screen.getByText(/voters in this list/)).toBeInTheDocument(),
  )
}

describe('NativeDoorKnockingPage landing rail', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  it('counts the whole district before a list is selected', async () => {
    renderPage()

    const line = await screen.findByText(
      /voters in your district with a mapped address/,
    )
    expect(line).toHaveTextContent(
      '4 voters in your district with a mapped address',
    )
    expect(
      screen.getByRole('heading', { name: 'District voters' }),
    ).toBeInTheDocument()
    expect(chip('Support unknown', 3)).toBeInTheDocument()
    expect(chip('Supporter', 1)).toBeInTheDocument()
  })

  // The regression: the heading and the line under it rescoped to the selected
  // turf while the seven legend counts stayed district-wide, so the numbers
  // described a different audience than the heading above them named.
  it('rescopes the legend counts to the selected list', async () => {
    renderPage()
    await selectTurf()

    expect(
      screen.getByRole('heading', { name: 'Elm St & 5th' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/3\s*voters in this list/)).toBeInTheDocument()

    // Person 3 is an unknown outside the ring: 3 district-wide, 2 in the list.
    expect(chip('Support unknown', 2)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Support unknown\s*3/ }),
    ).toBeNull()
    expect(chip('Supporter', 1)).toBeInTheDocument()
  })

  // Left to fitBounds the map opens at district zoom, where there is nothing
  // to orient against. 16 is where street names appear.
  it('opens the map at street-level zoom', async () => {
    renderPage()

    const map = await screen.findByTestId('voter-map')
    expect(map).toHaveAttribute('data-initial-zoom', '16')
  })

  // A list is its filters as well as its polygon, which is the whole reason
  // the scope isn't just the ring. Person 0 is the only Democrat inside it.
  it('scopes by the saved list filters, not only by its polygon', async () => {
    renderPage([{ id: 7, partyDemocrat: true }])
    await selectTurf()

    expect(screen.getByText(/1\s*voters in this list/)).toBeInTheDocument()
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-people', '1')
    // The two unknowns at the same dot are Republican and Unknown, so the
    // legend has to drop them along with the map.
    expect(chip('Supporter', 1)).toBeInTheDocument()
    expect(chip('Support unknown', 0)).toBeInTheDocument()
  })

  // The chips were pressed-but-inert with a list selected: the turf branch of
  // `selections` returned before statusFilter was ever read, so aria-pressed
  // flipped and the map stayed exactly as it was.
  it('filters within the selected list when a status chip is clicked', async () => {
    renderPage()
    await selectTurf()

    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-people', '3')

    fireEvent.click(chip('Support unknown', 2))

    // 2, not 3: the chip narrows inside the list rather than replacing its
    // scope with a district-wide status filter.
    await waitFor(() =>
      expect(screen.getByText(/2\s*voters in this list/)).toBeInTheDocument(),
    )
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-people', '2')
    expect(chip('Support unknown', 2)).toHaveAttribute('aria-pressed', 'true')
  })

  // Leaving a scope has to drop the chip too. Carried across the boundary it
  // would silently re-narrow the district to whatever status was pressed
  // inside the list, under a heading that has gone back to naming everything.
  it('returns to an unfiltered district on Show all', async () => {
    renderPage()
    await selectTurf()

    fireEvent.click(chip('Support unknown', 2))
    await waitFor(() =>
      expect(screen.getByText(/2\s*voters in this list/)).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))

    const line = await screen.findByText(
      /voters in your district with a mapped address/,
    )
    expect(line).toHaveTextContent(
      '4 voters in your district with a mapped address',
    )
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-people', '4')
    expect(chip('Support unknown', 3)).toHaveAttribute('aria-pressed', 'false')
  })

  // The create flow hides the chips and short-circuits `selections` while it
  // is open, so a chip left pressed on the way in is invisible until the flow
  // closes and the district quietly comes back narrowed.
  it('returns to an unfiltered district when the create flow closes', async () => {
    renderPage()
    await screen.findByText(/voters in your district with a mapped address/)

    fireEvent.click(chip('Support unknown', 3))
    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-people',
        '3',
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create list' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Close list creation' }),
    )

    const line = await screen.findByText(
      /voters in your district with a mapped address/,
    )
    expect(line).toHaveTextContent(
      '4 voters in your district with a mapped address',
    )
    expect(chip('Support unknown', 3)).toHaveAttribute('aria-pressed', 'false')
  })

  // A legend that narrowed with its own chip would zero the other six counts
  // and leave nothing to press back.
  it('keeps the legend counts describing the list, not the pressed chip', async () => {
    renderPage()
    await selectTurf()

    fireEvent.click(chip('Support unknown', 2))

    await waitFor(() =>
      expect(screen.getByText(/2\s*voters in this list/)).toBeInTheDocument(),
    )
    expect(chip('Supporter', 1)).toBeInTheDocument()
    expect(chip('Support unknown', 2)).toBeInTheDocument()
  })
})

// Below lg the rail is a sheet over a full-bleed map instead of a 384px column
// beside it, which on a 390px phone left the map about six pixels wide. The
// two-pane desktop layout is the same markup at lg, so the toggle only ever
// swaps a display class — it never unmounts the lists or the legend, and
// nothing reads the viewport to decide what to render.
describe('NativeDoorKnockingPage small-screen shell', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  it('peeks the rail over the map and opens it in one tap', async () => {
    renderPage()

    const handle = await screen.findByRole('button', {
      name: /Lists and legend/,
    })
    const rail = document.getElementById('door-knocking-rail')
    expect(handle).toHaveAttribute('aria-expanded', 'false')
    expect(rail).toHaveClass('hidden')
    // Over the map on a phone, in the flex row on a desktop.
    expect(handle.parentElement).toHaveClass('absolute', 'lg:static')

    fireEvent.click(handle)

    expect(handle).toHaveAttribute('aria-expanded', 'true')
    expect(rail).toHaveClass('flex')
    expect(rail).not.toHaveClass('hidden')
  })

  // The rail is unmounted for the whole create flow, so its open state is the
  // one piece of landing-map state that would come back on its own — the sheet
  // would spring up over the map the moment the flow closed.
  it('leaves the sheet closed on the way out of the create flow', async () => {
    renderPage()
    await screen.findByText(/voters in your district with a mapped address/)

    const handle = screen.getByRole('button', { name: /Lists and legend/ })
    fireEvent.click(handle)
    expect(handle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Create list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close list creation' }))

    expect(
      screen.getByRole('button', { name: /Lists and legend/ }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById('door-knocking-rail')).toHaveClass('hidden')
  })

  it('keeps the rail a column at lg however the sheet is set', async () => {
    renderPage()
    await screen.findByText('Elm St & 5th')

    const handle = screen.getByRole('button', {
      name: /Lists and legend/,
    })
    const rail = document.getElementById('door-knocking-rail')
    expect(rail).toHaveClass('lg:flex')
    // The sheet's handle is the phone affordance only; the desktop rail has
    // nothing to expand.
    expect(handle).toHaveClass('lg:hidden')
    // Collapsed on a phone is still mounted, so the desktop pane renders the
    // saved lists and the legend without touching the toggle.
    expect(screen.getByText('Elm St & 5th')).toBeInTheDocument()
    expect(chip('Supporter', 1)).toBeInTheDocument()
  })

  // Drawing a turf is repeated taps on a WebGL canvas, so the draw step needs
  // the whole map at any width — the rail is not merely narrower there, it is
  // gone, and the flow's own chrome is a click-through overlay.
  it('gives the draw step the whole map', async () => {
    renderPage()

    await screen.findByText(/voters in your district with a mapped address/)

    fireEvent.click(screen.getByRole('button', { name: 'Create list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(document.getElementById('door-knocking-rail')).toBeNull()
    expect(screen.getByTestId('voter-map')).toBeInTheDocument()
  })

  // The whole draw step as a canvasser meets it: no Done button anywhere, a
  // three-point minimum nothing used to name, and a Continue that has to turn
  // into the finish gesture on the third tap.
  it('walks filters → three taps → confirm', async () => {
    drawSession.placed = []
    renderPage()
    await screen.findByText(/voters in your district with a mapped address/)

    fireEvent.click(screen.getByRole('button', { name: 'Create list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    expect(
      screen.getByRole('button', { name: 'Tap 3 points to continue' }),
    ).toBeDisabled()

    fireEvent.click(tapMap)
    expect(
      screen.getByRole('button', { name: '2 more points to continue' }),
    ).toBeDisabled()

    fireEvent.click(tapMap)
    expect(
      screen.getByRole('button', { name: '1 more point to continue' }),
    ).toBeDisabled()

    fireEvent.click(tapMap)
    const advance = await screen.findByRole('button', {
      name: /Continue \(\d+ doors\)/,
    })
    expect(advance).toBeEnabled()

    fireEvent.click(advance)

    expect(screen.getByLabelText('Route name')).toBeInTheDocument()
  })
})

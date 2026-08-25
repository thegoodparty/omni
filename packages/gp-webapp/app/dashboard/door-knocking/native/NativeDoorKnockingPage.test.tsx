import { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DoorKnockingTurf, DoorKnockStatus } from '@goodparty_org/contracts'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import NativeDoorKnockingPage from './NativeDoorKnockingPage'

// The test renderer wraps only QueryClientProvider, and every rail row now
// carries a delete control that reports through useSnackbar, which throws
// outside its provider.
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))
vi.mocked(useSnackbar).mockReturnValue({
  successSnackbar: vi.fn(),
  errorSnackbar: vi.fn(),
} as unknown as ReturnType<typeof useSnackbar>)

// 4 people over 2 dots. Person 0 is a Democratic supporter and persons 1-2 are
// unknown, all three at dot 0; person 3 is unknown at dot 1, outside the saved
// turf below. So the district reads 3 unknown / 1 supporter and the turf reads
// 2 unknown / 1 supporter — the two numbers the rail has to tell apart — while
// the party plane gives a saved list something of its own to narrow by.
// A triangle around both dots, tapped one vertex at a time, so the draw step
// can be walked the way a canvasser walks it: the stub reports each tap the
// way the canvas does, including its three-point gate on the ring.
const { drawSession, packFixture, packControl } = vi.hoisted(() => ({
  // Lets one test hold the pack in flight while the saved lists settle — the
  // ordinary cache ordering, and the one the rail used to misread as failure.
  packControl: { pending: false },
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
        {
          key: 'canvassStatus',
          values: ['unknown', 'not_home', 'supporter'],
        },
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
    queryFn: async () => {
      if (packControl.pending) await new Promise(() => undefined)
      return packFixture
    },
  },
}))
// deck.gl and maplibre don't run in jsdom. The stub reports the filtered
// people count so a chip click can be checked against the map, not just
// against the rail's own copy.
vi.mock('./VoterMapCanvas', () => ({
  __esModule: true,
  default: ({
    filterResult,
    turfs,
    routePins,
    selectedStopId,
    initialZoom,
    drawColor,
    frameDrawToken,
    frameDrawBottomPct,
    controlsHidden,
    location,
    onPolygonChange,
    onDrawPointCount,
    onRoutePinClick,
  }: {
    filterResult: { people: number }
    turfs: Array<{ id: number; archivedAt: Date | null }>
    routePins: Array<{ stopId: number; seq: number }>
    selectedStopId: number | null
    initialZoom?: number
    drawColor: string
    frameDrawToken: number
    frameDrawBottomPct: number
    controlsHidden?: boolean
    location: { status: string }
    onPolygonChange: (ring: Array<[number, number]> | null) => void
    onDrawPointCount?: (count: number) => void
    onRoutePinClick?: (pin: { stopId: number }) => void
  }) => (
    <div
      data-testid="voter-map"
      data-people={String(filterResult.people)}
      // How many outlines the map was handed, which is what a per-list hide
      // changes — the dots are the pack's and are unaffected.
      data-turfs={String(turfs.length)}
      // Whether an archived list is still among them. Dimming happens inside
      // the canvas off `archivedAt`; what the page owes it is the row.
      data-archived-turfs={turfs
        .filter((entry) => entry.archivedAt !== null)
        .map((entry) => entry.id)
        .join(',')}
      // The stop the map is ringing. The walk list marks the same one, so this
      // is the value that has to agree with the row carrying `aria-current`.
      data-selected-stop={String(selectedStopId)}
      // The numeral the ringed pin draws — `seq`, the frozen route order, which
      // is also what the marked row prints.
      data-selected-seq={String(
        routePins.find((pin) => pin.stopId === selectedStopId)?.seq ?? null,
      )}
      data-initial-zoom={String(initialZoom)}
      // The colour the in-progress boundary is drawn in. It is the confirm
      // step's pick, which is why it has to arrive here at all: a candidate
      // choosing the colour their list will be drawn in has nothing to judge it
      // by unless the shape on screen is already wearing it.
      data-draw-color={drawColor}
      // Bumped by a step that has just covered part of the map, with the covered
      // fraction beside it so the fit lands in the band that is left.
      data-frame={String(frameDrawToken)}
      data-frame-bottom={String(frameDrawBottomPct)}
      // The band the confirm step uncovers is shielded from taps, so the map's
      // own buttons standing in it would be dead ones.
      data-controls-hidden={String(Boolean(controlsHidden))}
      // The canvasser's own position, read from the page's watch. The switch
      // for it is the walk's, so this attribute is how a press on the walk's
      // pill is shown to have reached the map that draws the dot.
      data-location-status={location.status}
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
      {routePins.map((pin) => (
        <button
          key={pin.stopId}
          type="button"
          onClick={() => onRoutePinClick?.(pin)}
        >
          {`tap pin ${pin.stopId}`}
        </button>
      ))}
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
// Real state rather than a null stub: the walk swaps the rail out for
// WalkView, so anything the page has to reset on the way back needs a session
// the test can actually start and end.
vi.mock('./useWalkSession', async () => {
  const { useState } = await import('react')
  return {
    useWalkSession: () => {
      const [walkedTurf, setWalkedTurf] = useState<{
        id: number
        name: string
      } | null>(null)
      return {
        turf: walkedTurf,
        start: (started: { id: number; name: string }) =>
          setWalkedTurf(started),
        end: () => {
          setWalkedTurf(null)
          return 0
        },
        recordDoor: vi.fn(),
      }
    },
  }
})

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
  doorCount: null,
  peopleCount: null,
  loggedCount: null,
  completedAt: null,
  archivedAt: null,
  createdAt: new Date('2026-07-21T00:00:00Z'),
  updatedAt: new Date('2026-07-21T00:00:00Z'),
}

const chip = (label: string, count: number) =>
  screen.getByRole('button', { name: new RegExp(`${label}\\s*${count}`) })

// The turf points at saved filter 7, so the default is that list existing with
// no options set — a real list that legitimately targets everyone inside its
// ring. That is a different claim from the list being absent, which is what
// `[]` here means and what the rail must refuse to count.
const renderPage = (savedLists: SegmentResponse[] = [{ id: 7 }]) => {
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

// Opening the flow and walking it to the draw step. The create flow gained
// two pre-draw steps — a goal card, then the audience — and both live inside
// the page's single `filters` step, so the transition these tests are actually
// about (filters → draw, the one that starts a drawing session) is unchanged.
// Reaching it just takes two presses now.
const openFlowAndDraw = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Create list' }))
  fireEvent.click(screen.getByRole('button', { name: /Introduce myself/ }))
  fireEvent.click(screen.getByRole('button', { name: /^Continue \(/ }))
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

// One stop, one resident. `seq` is the frozen route order — served here in
// order, since the walk sorts by it either way and these tests are about the
// two surfaces naming the same stop with the same numeral.
const walkStop = (
  id: number,
  seq: number,
  displayAddress: string,
  name: string,
  knockStatus: DoorKnockStatus = 'unknown',
) => ({
  id,
  seq,
  lat: 36.16,
  lng: -86.78,
  displayAddress,
  legSeconds: 0,
  legMeters: 0,
  addresses: [
    {
      addressKey: `${id}|elm|st`,
      address: displayAddress,
      otherResidents: [],
      targets: [
        {
          stopTargetId: id + 10,
          personId: `person-${id}`,
          name,
          age: 40,
          politicalParty: null,
          cellPhone: null,
          landline: null,
          knockStatus,
          mayHaveMoved: false,
          doNotKnock: false,
        },
      ],
    },
  ],
})

const routePayloadOf = (stops: ReturnType<typeof walkStop>[]) => ({
  route: {
    id: 5,
    doorKnockingTurfId: 1,
    mode: 'walk' as const,
    loop: false,
    totalSeconds: 600,
    totalMeters: 800,
    stopCount: stops.length,
    createdAt: new Date('2026-07-21T00:00:00Z'),
  },
  pathGeometry: null,
  stops,
})

// Into a walk on the one saved list, which is locked and so goes straight into
// its frozen route with no confirm dialog.
const startWalk = async (
  stops = [
    walkStop(11, 1, '105 Elm St', 'Dorian Fen'),
    walkStop(12, 2, '210 Cedar Row', 'Marisol Vega'),
  ],
) => {
  api.mock('GET /v1/door-knocking/turfs', {
    status: 200,
    data: [{ ...turf, locked: true }],
  })
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    data: [{ id: 7 }],
  })
  api.mock('GET /v1/door-knocking/turfs/:id/route', {
    status: 200,
    data: routePayloadOf(stops),
  })
  render(
    <NativeDoorKnockingPage
      pathname="/dashboard/door-knocking"
      campaign={null}
    />,
  )
  await screen.findByText('Elm St & 5th')
  fireEvent.click(screen.getByRole('button', { name: 'Knock' }))
  return screen.findByRole('button', { name: 'tap pin 11' })
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

  // The rail's count is exact for what the pack can compute and a superset of
  // who gets knocked, so it is softened — and the softening has to name the
  // map as the limitation, never the filter, or a candidate reads it as their
  // targeting silently failing.
  it('softens the list count and says why it is a superset', async () => {
    renderPage()
    await selectTurf()

    expect(screen.getByText(/About\s*3\s*voters in this list/)).toBeTruthy()
    const caveat = screen.getByText(/the map can.t show every filter/i)
    expect(caveat.textContent).toContain('do-not-knock')
    expect(caveat.textContent).toContain('fewer doors')
  })

  // The same sentence the draw step shows, off the same helper: 65+ has no pack
  // bucket at all, so the shaded preview covers every age — while the saved
  // list still bounds it at 65 when the route is built.
  it('discloses a selected list filter the map cannot shade', async () => {
    renderPage([{ id: 7, age65Plus: true }])
    await selectTurf()

    const disclosure = screen.getByText((_, element) => {
      if (element?.tagName !== 'P') return false
      return /can’t shade by 65\+ yet/.test(element.textContent ?? '')
    })
    expect(disclosure.textContent).toContain('still applies it when you knock')
  })

  it('names no unshadeable filter when every one of them maps', async () => {
    renderPage([{ id: 7, partyDemocrat: true }])
    await selectTurf()

    expect(screen.queryByText(/can’t shade by/)).toBeNull()
  })

  // The last hop of the empty rail's Create list button (#1452 wired it as far
  // as the manage view and stopped at the fence). Without it the rail falls
  // back to naming a button it cannot press, which is what the empty state did
  // before and is indistinguishable from the feature not existing.
  it('opens the create flow from the empty rail’s own button', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    render(
      <NativeDoorKnockingPage
        pathname="/dashboard/door-knocking"
        campaign={null}
      />,
    )
    await screen.findByText(/No lists yet/)

    // Two buttons open one flow, so the rail's is scoped away from the
    // header's rather than matched by name alone.
    const rail = document.getElementById('door-knocking-rail') as HTMLElement
    const create = await waitFor(() => {
      const button = within(rail).getByRole('button', { name: 'Create list' })
      expect(button).toBeEnabled()
      return button
    })

    fireEvent.click(create)

    expect(await screen.findByText(/Introduce myself/)).toBeInTheDocument()
    // And no fallback copy standing in for the wiring.
    expect(screen.queryByText(/Use Create list above/)).toBeNull()
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

// `savedListFilterKeys(undefined)` is `{}`, which every consumer reads as "no
// filters" and answers with the whole polygon's population under the selected
// list's name. The heading, the count, the seven legend chips and the dot mask
// all hang off one scope, so all four have to refuse together.
describe('NativeDoorKnockingPage unresolved list scope', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })
  afterEach(() => {
    packControl.pending = false
  })

  // The scope needs the manifest as much as the list, and a warm list cache
  // against a cold pack is the ordinary ordering — Contacts populates the
  // lists, the pack is this page's own large fetch. Gating pending on the list
  // query alone made that case fall through to the settled branch, so the chips
  // printed the em dash that claims a permanent failure at something still
  // loading. The count line is gated on the pack and so absent here; the chips
  // render either way, which is why they are what this asserts.
  it('skeletons the chips rather than em-dashing them while only the pack is in flight', async () => {
    packControl.pending = true
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [turf] })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 7 }],
    })
    render(
      <NativeDoorKnockingPage
        pathname="/dashboard/door-knocking"
        campaign={null}
      />,
    )
    await selectRow()

    const supporter = await screen.findByRole('button', { name: /Supporter/ })
    await waitFor(() =>
      expect(supporter.querySelector('.animate-pulse')).toBeInTheDocument(),
    )
    expect(supporter.textContent).not.toContain('—')
  })

  const selectRow = async () => {
    await waitFor(() =>
      expect(screen.getByText('Elm St & 5th')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('Elm St & 5th'))
  }

  it('waits rather than printing the polygon count while the lists load', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [turf] })
    // Never settles, so the scope stays in flight for the whole test.
    api.mock(
      'GET /v1/voters/voter-file/filters',
      () => new Promise(() => undefined),
    )
    render(
      <NativeDoorKnockingPage
        pathname="/dashboard/door-knocking"
        campaign={null}
      />,
    )
    await selectRow()

    expect(
      await screen.findByText(/Counting the voters in this list/),
    ).toBeInTheDocument()
    // 3 is the ring's population with no filters applied — the plausible wrong
    // number this branch exists to withhold.
    expect(screen.queryByText(/3\s*voters in this list/)).toBeNull()
    // The heading still names the scope the candidate picked: it is not a claim
    // about size, and the line underneath is where the claim lives.
    expect(
      screen.getByRole('heading', { name: 'Elm St & 5th' }),
    ).toBeInTheDocument()
    // And the seven chips print no counts, for the same reason.
    expect(
      screen.queryByRole('button', { name: /Support unknown\s*\d/ }),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: /Support unknown/ }),
    ).toBeDisabled()
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-people', '0')
  })

  // The state that never self-corrects: the filter is gone from Contacts, so
  // waiting forever would be a lie and falling through to the ring's count
  // would be the original bug made permanent.
  it('does not fall through to an unfiltered count for a list deleted in the CRM', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [turf] })
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    render(
      <NativeDoorKnockingPage
        pathname="/dashboard/door-knocking"
        campaign={null}
      />,
    )
    await selectRow()

    expect(
      await screen.findByText(/filters could not be loaded/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/3\s*voters in this list/)).toBeNull()
    expect(screen.queryByText(/Counting the voters/)).toBeNull()
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-people', '0')
    // Reachable in every state: this is the one a candidate needs a way out of.
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    const line = await screen.findByText(
      /voters in your district with a mapped address/,
    )
    expect(line).toHaveTextContent(
      '4 voters in your district with a mapped address',
    )
  })

  // A failed fetch and a deleted filter are the same settled claim — there is
  // no audience to report — and neither may borrow the loading state.
  it('treats a failed lists fetch as settled, not as loading', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [turf] })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 500,
      data: { message: 'boom' },
    })
    render(
      <NativeDoorKnockingPage
        pathname="/dashboard/door-knocking"
        campaign={null}
      />,
    )
    await selectRow()

    expect(
      await screen.findByText(/filters could not be loaded/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/3\s*voters in this list/)).toBeNull()
  })
})

// Per-list visibility: client-side display state, in the same category as the
// selection and the status chips.
describe('NativeDoorKnockingPage list visibility', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  const second: DoorKnockingTurf = {
    ...turf,
    id: 2,
    voterFileFilterId: 8,
    name: 'Riverside loop',
  }

  const renderTwo = () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf, second],
    })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 7 }, { id: 8 }],
    })
    return render(
      <NativeDoorKnockingPage
        pathname="/dashboard/door-knocking"
        campaign={null}
      />,
    )
  }

  // The eye and the archive are two different answers and must not fight. The
  // eye REMOVES a ring from the map — that is this filter — while archiving
  // only quiets one, which the canvas does off `archivedAt` on the row it is
  // still handed. So an archived list is still drawn (a ring that vanished on
  // archive would leave the shelf looking exactly like a delete), and hiding
  // one still hides it: the strength is only ever applied to what is drawn.
  it('keeps handing the map an archived list, and still drops it when hidden', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf,
        {
          ...second,
          locked: true,
          completedAt: new Date('2026-08-20T00:00:00Z'),
          archivedAt: new Date('2026-08-22T00:00:00Z'),
        },
      ],
    })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 7 }, { id: 8 }],
    })
    render(
      <NativeDoorKnockingPage
        pathname="/dashboard/door-knocking"
        campaign={null}
      />,
    )
    await screen.findByText('Riverside loop')

    const map = screen.getByTestId('voter-map')
    expect(map).toHaveAttribute('data-turfs', '2')
    expect(map).toHaveAttribute('data-archived-turfs', '2')

    // The archived row keeps its eye, which is the only way to get an archived
    // outline off the map entirely.
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide Riverside loop on the map' }),
    )

    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-turfs', '1')
    expect(screen.getByTestId('voter-map')).toHaveAttribute(
      'data-archived-turfs',
      '',
    )
  })

  // The create flow unmounts the rail, and with it the eye toggle that is the
  // only disclosure a ring is hidden. Coming back to a quieted outline nobody
  // remembers quieting is the same stranding the chips and the phone sheet
  // reset for, so hidden rings follow the same rule.
  it('restores hidden rings when the create flow closes', async () => {
    renderTwo()
    await screen.findByText('Elm St & 5th')

    fireEvent.click(
      screen.getByRole('button', { name: 'Hide Elm St & 5th on the map' }),
    )
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-turfs', '1')

    fireEvent.click(screen.getByRole('button', { name: 'Create list' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Close list creation' }),
    )

    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-turfs',
        '2',
      ),
    )
    expect(
      screen.getByRole('button', { name: 'Hide Elm St & 5th on the map' }),
    ).toBeInTheDocument()
  })

  // Same rule on the way back from a walk, which replaces the rail outright and
  // is the longer of the two absences.
  it('restores hidden rings when a walk ends', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [{ ...turf, locked: true }, second],
    })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 7 }, { id: 8 }],
    })
    // The route's own content isn't what this asserts, only what leaving it
    // restores.
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 500,
      data: { message: 'no route in this test' },
    })
    render(
      <NativeDoorKnockingPage
        pathname="/dashboard/door-knocking"
        campaign={null}
      />,
    )
    await screen.findByText('Riverside loop')

    fireEvent.click(
      screen.getByRole('button', { name: 'Hide Riverside loop on the map' }),
    )
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-turfs', '1')

    // A locked turf goes straight into its saved route, no confirm dialog —
    // scoped to its own row, since both lists carry a Knock button.
    fireEvent.click(
      within(screen.getByTestId('turf-row-1')).getByRole('button', {
        name: 'Knock',
      }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Back to the map' }),
    )

    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-turfs',
        '2',
      ),
    )
  })

  it('drops only the hidden list from the map', async () => {
    renderTwo()
    await screen.findByText('Elm St & 5th')
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-turfs', '2')

    fireEvent.click(
      screen.getByRole('button', { name: 'Hide Elm St & 5th on the map' }),
    )

    // The other ring is untouched, and the dots are the pack's either way:
    // hiding is display state, not a filter.
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-turfs', '1')
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-people', '4')
    expect(
      screen.getByRole('button', { name: 'Show Elm St & 5th on the map' }),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Show Elm St & 5th on the map' }),
    )
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-turfs', '2')
  })

  // The heading, the count, the legend and the dot mask all describe the
  // selection, so hiding the selected list has to release it — otherwise the
  // rail keeps shouting about a list whose outline is no longer drawn.
  it('deselects the list it hides', async () => {
    renderTwo()
    await screen.findByText('Elm St & 5th')
    fireEvent.click(screen.getByText('Elm St & 5th'))
    await waitFor(() =>
      expect(screen.getByText(/voters in this list/)).toBeInTheDocument(),
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Hide Elm St & 5th on the map' }),
    )

    const line = await screen.findByText(
      /voters in your district with a mapped address/,
    )
    expect(line).toHaveTextContent(
      '4 voters in your district with a mapped address',
    )
    expect(
      screen.getByRole('heading', { name: 'District voters' }),
    ).toBeInTheDocument()
  })

  // The camera is about to frame this ring and the dots are about to mask to
  // it, so selecting a hidden list draws it again rather than framing a
  // boundary the candidate cannot see.
  it('reveals a hidden list when it is selected', async () => {
    renderTwo()
    await screen.findByText('Elm St & 5th')
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide Elm St & 5th on the map' }),
    )
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-turfs', '1')

    fireEvent.click(screen.getByText('Elm St & 5th'))

    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-turfs',
        '2',
      ),
    )
  })
})

// Below lg the rail is a sheet over a full-bleed map instead of a 384px column
// beside it, which on a 390px phone left the map about six pixels wide. The
// two-pane desktop layout is the same markup at lg, so the toggle only ever
// swaps a display class — it never unmounts the lists or the legend, and
// nothing reads the viewport to decide what to render.
// A scan of people-db for one shape, so "it only runs when it is asked for"
// is counted rather than trusted — the ring changes with every vertex, and a
// request per change is the failure mode this panel is designed around.
const previewCalls = { count: 0 }
const mockPreview = () => {
  previewCalls.count = 0
  api.mock('POST /v1/door-knocking/address-preview', () => {
    previewCalls.count += 1
    return {
      status: 200,
      data: {
        stops: 2,
        doors: 3,
        people: 4,
        locations: [
          {
            doors: [
              { address: '1200 W Elm St Apt 1', people: 2 },
              { address: '1200 W Elm St Apt 2', people: 1 },
            ],
          },
          { doors: [{ address: '14 N Oak Ave', people: 1 }] },
        ],
      },
    }
  })
}

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
    // Over the map at every width now: a bottom sheet on a phone, a floating
    // inset card on a desktop. It used to take a 384px column out of the flex
    // row above `lg`, which is what the full-bleed rebuild removed.
    expect(handle.parentElement).toHaveClass('absolute')
    expect(handle.parentElement).not.toHaveClass('lg:static')

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

  // The walk replaces the rail outright, so it strands the sheet the same way
  // the create flow does — and a canvasser coming back from a walk is looking
  // at the map, not asking for half of it back.
  it('leaves the sheet closed on the way back from a walk', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [{ ...turf, locked: true }],
    })
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    // The walk view's own content is not what this asserts, only that leaving
    // it puts the sheet back the way the canvasser left the landing map.
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 500,
      data: { message: 'no route in this test' },
    })
    render(
      <NativeDoorKnockingPage
        pathname="/dashboard/door-knocking"
        campaign={null}
      />,
    )
    await screen.findByText('Elm St & 5th')

    fireEvent.click(screen.getByRole('button', { name: /Lists and legend/ }))
    // A locked turf goes straight into its saved route, no confirm dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Knock' }))
    expect(document.getElementById('door-knocking-rail')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back to the map' }))

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

    openFlowAndDraw()

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

    openFlowAndDraw()

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

  // The seam crossing this change is about: the colour picker sits in the flow,
  // the ring it describes is drawn by the canvas, and the canvas outlives the
  // flow — so the pick travels up to the page and back down as a canvas prop.
  // The confirm step also covers most of the map, so the page asks for the shape
  // to be re-framed into the band it leaves.
  it('tints the map with the colour the confirm step is picking', async () => {
    drawSession.placed = []
    renderPage()
    await screen.findByText(/voters in your district with a mapped address/)

    openFlowAndDraw()

    const map = screen.getByTestId('voter-map')
    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    // Drawing frames nothing: the canvasser is the one aiming the camera while
    // they place points.
    expect(map).toHaveAttribute('data-frame', '0')

    fireEvent.click(
      await screen.findByRole('button', { name: /Continue \(\d+ doors\)/ }),
    )

    // Entering confirm asks for one fit, against the 70% the sheet covers, and
    // takes the map's buttons down: the band it uncovers is shielded from taps,
    // so a "+" standing in it is one that answers nothing.
    expect(map).toHaveAttribute('data-frame', '1')
    expect(map).toHaveAttribute('data-frame-bottom', '70')
    expect(map).toHaveAttribute('data-controls-hidden', 'true')
    expect(map).toHaveAttribute('data-draw-color', '#2563eb')

    fireEvent.click(screen.getByRole('button', { name: 'Green' }))

    expect(map).toHaveAttribute('data-draw-color', '#16a34a')
    // And the picker follows the page's answer, so the tick and the ring are one
    // fact rather than two.
    expect(screen.getByRole('button', { name: 'Green' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // Leaving the flow puts the colour back: this state now outlives the step
    // that owns it, so what unmounting used to do has to be done by hand.
    fireEvent.click(screen.getByRole('button', { name: 'Close list creation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(map).toHaveAttribute('data-draw-color', '#2563eb')
    // And the map is a map again, not a picture.
    expect(map).toHaveAttribute('data-controls-hidden', 'false')
  })

  // What the walkthrough asked for: the actual houses, at the one moment the
  // shape can still be changed. The pack has no addresses in it, so these come
  // from gp-api's evaluation — and a block of flats reads as the several doors
  // it is under the single coordinate the router will visit.
  it('lists the addresses inside the drawn ring, on request', async () => {
    drawSession.placed = []
    mockPreview()
    renderPage()
    await screen.findByText(/voters in your district with a mapped address/)

    openFlowAndDraw()

    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)

    await screen.findByRole('button', { name: 'Continue (3 doors)' })
    // Drawing the shape asks nothing of the server, and a shut panel has no
    // count to read off.
    expect(previewCalls.count).toBe(0)
    expect(document.getElementById('draw-step-doors')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'See the addresses' }))
    await screen.findByText('1200 W Elm St Apt 1')

    const panel = document.getElementById('draw-step-doors')
    expect(panel?.querySelectorAll('li li')).toHaveLength(3)
    expect(screen.getByText('2 doors at one location')).toBeInTheDocument()
    expect(previewCalls.count).toBe(1)
  })

  // The rule the create flow has already broken once: one quantity, one
  // number. The pack's estimate is a superset — it can't shade by every filter
  // and it can't drop a do-not-knock resident — so once the exact count
  // exists the estimate is not a second opinion to print beside it. The
  // fixture's ring holds 3 doors by the pack and 3 by the server on purpose:
  // the counts here are deliberately different so the swap is visible.
  it('reports the server count once it has one', async () => {
    drawSession.placed = []
    api.mock('POST /v1/door-knocking/address-preview', () => ({
      status: 200,
      data: {
        stops: 1,
        doors: 2,
        people: 2,
        locations: [
          {
            doors: [
              { address: '1200 W Elm St Apt 1', people: 1 },
              { address: '1200 W Elm St Apt 2', people: 1 },
            ],
          },
        ],
      },
    }))
    renderPage()
    await screen.findByText(/voters in your district with a mapped address/)

    openFlowAndDraw()

    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    await screen.findByRole('button', { name: 'Continue (3 doors)' })

    fireEvent.click(screen.getByRole('button', { name: 'See the addresses' }))

    // The pack's 3 doors is gone from the button, not printed next to the
    // server's 2.
    await screen.findByRole('button', { name: 'Continue (2 doors)' })
    expect(
      screen.queryByRole('button', { name: 'Continue (3 doors)' }),
    ).toBeNull()
  })

  // Backing out to the filters re-cuts the audience, and the step forward from
  // it wipes the shape — so an address panel left open would spring back over
  // a list nobody has asked about yet, and spend a scan of people-db to do it.
  // Same stranding closeFlow resets the rail's sheet for. The request count is
  // asserted and not assumed: "it only runs when it is asked for" is the whole
  // reason the page owns the flag.
  it('asks about the addresses again after the filters are re-cut', async () => {
    drawSession.placed = []
    mockPreview()
    renderPage()
    await screen.findByText(/voters in your district with a mapped address/)

    openFlowAndDraw()

    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    await screen.findByRole('button', { name: 'Continue (3 doors)' })
    expect(previewCalls.count).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'See the addresses' }))
    await screen.findByText('1200 W Elm St Apt 1')

    // Back lands on the audience step, whose CTA carries the district count.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    const callsOnLeaving = previewCalls.count
    fireEvent.click(screen.getByRole('button', { name: /^Continue \(/ }))

    expect(document.getElementById('draw-step-doors')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'See the addresses' }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(previewCalls.count).toBe(callsOnLeaving)
  })
})

// The map is the surface a canvasser is looking at with a house in front of
// them, so a pin has to be a way into that door's log — and something on screen
// has to say so.
describe('NativeDoorKnockingPage walk map', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  it('opens the door behind a tapped pin', async () => {
    const pin = await startWalk()

    fireEvent.click(pin)

    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('heading', { name: 'Dorian Fen' }),
    ).toBeInTheDocument()
  })

  // The list has marked the stop the walk is on since #1392; the map drew
  // nothing for it, because a mark on the canvas needs a prop on a canvas all
  // three modes share. Both halves now read one `selectedStopId`, so a row tap
  // rings a pin and a pin tap marks a row — and the numeral is `seq` on both,
  // never a DOM index, which is what makes "the pin under my thumb" findable
  // in a fifty-row list.
  it('marks one stop on the list and on the map, whichever half was tapped', async () => {
    await startWalk()

    // A pin tap: the map's own gesture, and the list has to follow it.
    fireEvent.click(screen.getByRole('button', { name: 'tap pin 12' }))

    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-selected-stop',
        '12',
      ),
    )
    const marked = () =>
      screen
        .getAllByRole('listitem')
        .map((item) => item.querySelector('button'))
        .filter((row) => row?.getAttribute('aria-current') === 'true')
    expect(marked()).toHaveLength(1)
    expect(marked()[0]).toHaveTextContent('Stop 2')
    // The same numeral on both halves: the pin's is `seq` off the route, the
    // row's is `seq` off the same payload.
    expect(screen.getByTestId('voter-map')).toHaveAttribute(
      'data-selected-seq',
      '2',
    )

    // A row tap: the list's own gesture, and the map has to follow that one.
    fireEvent.click(
      screen
        .getAllByRole('listitem')[0]
        ?.querySelector('button') as HTMLElement,
    )

    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-selected-stop',
        '11',
      ),
    )
    expect(marked()).toHaveLength(1)
    expect(marked()[0]).toHaveTextContent('Stop 1')
  })

  // Every walk opens on a route the canvasser has not seen, so the mark cannot
  // survive the way out — a pin ringed from last night's walk would be the
  // stranding rule broken on the surface it matters most.
  it('leaves no stop marked on the way back from a walk', async () => {
    await startWalk()
    fireEvent.click(screen.getByRole('button', { name: 'tap pin 12' }))
    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-selected-stop',
        '12',
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back to the map' }))

    expect(screen.getByTestId('voter-map')).toHaveAttribute(
      'data-selected-stop',
      'null',
    )
  })

  // The gesture was undiscoverable even once it worked: nothing on the walk
  // map said a pin was tappable.
  it('coaches the pin tap, and stops once the canvasser has made it', async () => {
    const pin = await startWalk()
    expect(screen.getByText('Tap a pin to log the door.')).toBeInTheDocument()

    fireEvent.click(pin)

    await waitFor(() =>
      expect(screen.queryByText('Tap a pin to log the door.')).toBeNull(),
    )
  })

  // The landing map has no pins, and a hint about them there would be about
  // nothing on screen.
  it('says nothing about pins on the landing map', async () => {
    renderPage()
    await screen.findByText(/voters in your district with a mapped address/)

    expect(screen.queryByText('Tap a pin to log the door.')).toBeNull()
  })

  // The canvas puts the walk's paper in the page header and calls it PDF. Ours
  // called it "Print list" and hid it in the chip row under the map, pointing
  // at the HTML print sheet — so the same artefact had two names depending on
  // which surface you asked from. It opens in its own tab, because the walk in
  // progress must not be navigated away from.
  it('offers the walk’s PDF from the header, beside the list’s name', async () => {
    await startWalk()

    // The header row: the list's name, the way back, and the paper.
    const header = () =>
      screen.getByRole('heading', { name: /Elm St & 5th|Door knocking/ })
        .parentElement?.parentElement as HTMLElement

    const link = within(header()).getByRole('link', { name: 'PDF' })
    expect(link).toHaveAttribute('href', '/dashboard/door-knocking/print/1/pdf')
    expect(link).toHaveAttribute('target', '_blank')

    fireEvent.click(screen.getByRole('button', { name: 'Back to the map' }))

    // Outside a walk the header has nothing to print — no list is open. (The
    // rail row and the details drawer carry their own, per list.)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create list' })).toBeVisible(),
    )
    expect(within(header()).queryByRole('link', { name: 'PDF' })).toBeNull()
  })
})

// One watch, two readers. The map draws the dot and outlives the walk; the
// control that turns it on is the walk's alone, exactly as in the canvas —
// which offers "My live location" in the walk's control row and on no other
// surface. So the state is the orchestrator's and both halves read it.
describe('NativeDoorKnockingPage live location', () => {
  beforeEach(() => {
    testQueryClient.clear()
    // jsdom has no geolocation, and the control hides itself without one.
    Object.defineProperty(navigator, 'geolocation', {
      value: { watchPosition: vi.fn(), clearWatch: vi.fn() },
      configurable: true,
    })
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      configurable: true,
    })
  })

  it('reaches the map from the walk’s own control', async () => {
    await startWalk()

    const map = screen.getByTestId('voter-map')
    expect(map).toHaveAttribute('data-location-status', 'off')

    fireEvent.click(screen.getByRole('button', { name: 'My live location' }))

    // `locating` is the watch running with no fix yet — the stub never calls
    // back, which is also what an unanswered permission prompt looks like.
    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-location-status',
        'locating',
      ),
    )
  })

  // Leaving is the only way out of a walk, and the walk row is the only place
  // the switch exists — so a watch left running would keep the GPS radio warm
  // for a surface with no way to see it and no way to stop it.
  it('stops watching on the way out of the walk', async () => {
    await startWalk()
    fireEvent.click(screen.getByRole('button', { name: 'My live location' }))
    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-location-status',
        'locating',
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back to the map' }))

    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-location-status',
        'off',
      ),
    )
  })

  // The landing map and the create flow have no such control. A candidate
  // drawing turfs at a desk is never asked for their position, and the refusal
  // is structural rather than a habit: there is no button to press.
  it('offers no location control outside a walk', async () => {
    renderPage()
    await screen.findByText(/voters in your district with a mapped address/)

    expect(
      screen.queryByRole('button', { name: 'My live location' }),
    ).toBeNull()
    expect(screen.getByTestId('voter-map')).toHaveAttribute(
      'data-location-status',
      'off',
    )
  })
})

// `endWalk` is the orchestrator's, which is why the list's own Done control
// could be wired on the card in #1395 and this could not. What it must NOT be
// is unconditional: leaving is the only way out of a walk, and Done takes the
// Knock control off the card, so stamping every exit would tell a canvasser who
// stopped after three doors that their list was finished.
describe('NativeDoorKnockingPage end of walk', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  const trackComplete = () => {
    const completed: string[] = []
    api.mock('POST /v1/door-knocking/turfs/:id/complete', ({ params }) => {
      completed.push(params.id)
      return {
        status: 200,
        data: {
          ...turf,
          locked: true,
          completedAt: new Date('2026-08-24T00:00:00Z'),
        },
      }
    })
    return completed
  }

  it('marks the list done when the walk left nothing to knock', async () => {
    const completed = trackComplete()
    await startWalk([
      walkStop(11, 1, '105 Elm St', 'Dorian Fen', 'not_home'),
      walkStop(12, 2, '210 Cedar Row', 'Marisol Vega', 'supporter'),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Back to the map' }))

    // `not_home` counts: the quantity is doors with an answer written down, the
    // same one the walk's own progress bar reads.
    await waitFor(() => expect(completed).toEqual(['1']))
  })

  it('leaves a half-walked list alone on the way out', async () => {
    const completed = trackComplete()
    await startWalk([
      walkStop(11, 1, '105 Elm St', 'Dorian Fen', 'not_home'),
      walkStop(12, 2, '210 Cedar Row', 'Marisol Vega'),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Back to the map' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create list' })).toBeVisible(),
    )
    expect(completed).toEqual([])
    // And the way back in is still on the card, which is the whole point.
    expect(await screen.findByRole('button', { name: 'Knock' })).toBeVisible()
  })

  // A serve that never landed reports no stops, which is indistinguishable from
  // a list with nobody in it — and Done is the one rail action with no undo
  // beside it, so it is never stamped off a fetch that failed.
  it('does not mark a list done off a route that failed to load', async () => {
    const completed = trackComplete()
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [{ ...turf, locked: true }],
    })
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 500,
      data: { message: 'boom' },
    })
    render(
      <NativeDoorKnockingPage
        pathname="/dashboard/door-knocking"
        campaign={null}
      />,
    )
    await screen.findByText('Elm St & 5th')
    fireEvent.click(screen.getByRole('button', { name: 'Knock' }))

    fireEvent.click(
      await screen.findByRole('button', { name: 'Back to the map' }),
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create list' })).toBeVisible(),
    )
    expect(completed).toEqual([])
  })
})

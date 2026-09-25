import { ComponentProps, ReactNode, useEffect, useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DoorKnockingTurf, DoorKnockStatus } from '@goodparty_org/contracts'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { TURF_COLORS, TURFS_QUERY_KEY } from './turfQueries'
import NativeDoorKnockingPage from './NativeDoorKnockingPage'

// The test renderer wraps only QueryClientProvider, and the page calls
// `useWalkCompletion` and `useWalkArchive` on every render — both reach
// `useTurfLifecycle`, which reports through useSnackbar and throws outside its
// provider.
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))

// 4 people over 2 dots. Person 0 is a Democratic supporter and persons 1-2 are
// unknown, all three at dot 0; person 3 is unknown at dot 1, outside the turf
// below. So the district holds 4 and the ring holds 3 — the two numbers the
// shaded map has to tell apart — while the party plane gives a carried list
// something of its own to narrow by.
// A triangle around both dots, tapped one vertex at a time, so the draw step
// can be walked the way a canvasser walks it: the stub reports each tap the
// way the canvas does, including its three-point gate on the ring.
const {
  districtResolution,
  drawSession,
  packSource,
  packFixture,
  organization,
  walkSession,
} = vi.hoisted(() => ({
  // What the closing walk reports it logged. Zero is a walk that changed
  // nothing on the map, which is every test here that is not about the doors
  // reaching it.
  walkSession: { doorsLogged: 0 },
  // Which org is selected. Mutable because it is what decides Win or Serve
  // for this page — a Campaign takes precedence and an `electedOfficeId` is
  // consulted in its absence — and both answers change where exits land.
  organization: {
    current: null as { electedOfficeId?: number; slug?: string } | null,
  },
  // Whether this org's district can be identified at all. Mutable because
  // the page's first branch is the one drawn when it cannot, and a static
  // mock can only ever exercise the other side of it.
  districtResolution: { isUnresolvable: false },
  // The two states the module-level pack stub otherwise never reaches. The
  // pack has to resolve for almost every test in this file, so holding and
  // failing it are switches rather than a second mock per test. `fetches`
  // counts district downloads, which is the quantity the walk's exit is not
  // allowed to spend.
  packSource: { failed: false, held: null as Promise<void> | null, fetches: 0 },
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

// Only the fetch is replaced. `recordLoggedKnocks` and the loading copy are
// real, because both are part of what this page does with the pack: the first
// is how a walk reaches the map without paying for the district again, and the
// second is what the create sheet and the map region have to agree on.
vi.mock('./useVoterPack', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useVoterPack')>()),
  voterPackQueryOptions: {
    queryKey: ['door-knocking-pack'],
    queryFn: async () => {
      packSource.fetches += 1
      if (packSource.held) await packSource.held
      if (packSource.failed) throw new Error('pack decode failed')
      return packFixture
    },
  },
}))
// deck.gl and maplibre don't run in jsdom. The stub reports the filtered people
// count so a change of scope can be checked against the map itself rather than
// against whatever the surface over it says about it.
vi.mock('./VoterMapCanvas', () => ({
  __esModule: true,
  // Draw step's static-map preview asks for the pack's bounds; the tests
  // don't exercise the image, so null is fine — the DrawStep omits it.
  packBounds: () => null,
  // Named, and named with a capital, so the stub reads as a component to
  // eslint's rules-of-hooks — it holds an effect now.
  default: function VoterMapCanvasStub({
    filterResult,
    turfs,
    routePins,
    selectedStopId,
    initialZoom,
    drawColor,
    drawOverCap,
    frameDrawToken,
    frameDrawBottomPct,
    controlsHidden,
    controlsBottomPx,
    location,
    liveLocationEnabled,
    startDrawToken,
    resumeDrawToken,
    onToggleLiveLocation,
    onPolygonChange,
    onDrawPointCount,
    onRoutePinClick,
  }: {
    filterResult: { people: number; statusPerDot: Uint8Array }
    turfs: Array<{ id: number; archivedAt: Date | null }>
    routePins: Array<{ stopId: number; seq: number }>
    selectedStopId: number | null
    initialZoom?: number
    drawColor: string
    drawOverCap?: boolean
    frameDrawToken: number
    frameDrawBottomPct: number
    controlsHidden?: boolean
    controlsBottomPx?: number
    location: { status: string }
    liveLocationEnabled?: boolean
    startDrawToken: number
    resumeDrawToken: number
    onToggleLiveLocation?: (next: boolean) => void
    onPolygonChange: (ring: Array<[number, number]> | null) => void
    onDrawPointCount?: (count: number) => void
    onRoutePinClick?: (pin: { stopId: number }) => void
  }) {
    // The real canvas empties the ring whenever `startDrawToken` is bumped.
    // The stub used to ignore the token entirely, so every page-level test
    // that entered the draw step kept whatever it had already drawn — which
    // is precisely why "the shape disappears on Back then Continue" shipped
    // green. Mirrored here, deliberately without a `resumeDrawToken` twin:
    // resuming re-arms drawing mode and touches neither the points nor the
    // ring, so there is nothing for the stub to imitate.
    // Keyed on the token ALONE, exactly as the real canvas is: it reads both
    // callbacks through refs and depends on `[startDrawToken, armDrawing]`.
    // Listing the callbacks here instead made this stub empty the ring
    // whenever the page handed down a new handler identity, which is a thing
    // the real canvas cannot do and which silently wiped a drawn shape.
    const resetRef = useRef({ onPolygonChange, onDrawPointCount })
    resetRef.current = { onPolygonChange, onDrawPointCount }
    useEffect(() => {
      if (startDrawToken === 0) return
      drawSession.placed = []
      resetRef.current.onDrawPointCount?.(0)
      resetRef.current.onPolygonChange(null)
    }, [startDrawToken])

    return (
      <div
        data-testid="voter-map"
        data-people={String(filterResult.people)}
        // The knock colour each dot is drawn in, as the status bytes behind it.
        // A walk's own doors reach the map through this and nothing else, so it
        // is what says whether they arrived without a fresh district download.
        data-statuses={Array.from(filterResult.statusPerDot).join(',')}
        // How many outlines the map was handed — every row `GET /turfs` returns.
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
        // Whether the drawn shape is over the 150-stop cap. The canvas swaps
        // the boundary's hue to destructive red when true; observable here so
        // the page-level wiring can be asserted without pulling in maplibre.
        data-draw-over-cap={String(Boolean(drawOverCap))}
        // Bumped by a step that has just covered part of the map, with the covered
        // fraction beside it so the fit lands in the band that is left.
        data-frame={String(frameDrawToken)}
        data-frame-bottom={String(frameDrawBottomPct)}
        // Where the zoom cluster sits, and whether it is drawn at all. Reported
        // up by whichever surface is covering the map from below, because only
        // that surface knows how tall it currently is.
        data-controls-hidden={String(Boolean(controlsHidden))}
        data-controls-bottom={String(controlsBottomPx)}
        // The canvasser's own position, read from the page's watch. The switch is
        // the cluster's third button, so this attribute is how a press on it is
        // shown to have reached the map that draws the dot.
        data-location-status={location.status}
        // The two ways the page puts the map into drawing mode. Both are
        // observable because which one it picks IS the decision under test: one
        // empties the ring and the other keeps it.
        data-start-draw={String(startDrawToken)}
        data-resume-draw={String(resumeDrawToken)}
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
        {/* The cluster's third button, offered only when the page hands down a
          handler — a surface with none would otherwise show a control that can
          produce a permission prompt and then nothing to show for it. */}
        {onToggleLiveLocation && (
          <button
            type="button"
            onClick={() => onToggleLiveLocation(!liveLocationEnabled)}
          >
            {liveLocationEnabled ? 'Hide my location' : 'Show my location'}
          </button>
        )}
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
    )
  },
}))
// The real layout is a sidebar shell this suite has no use for, but what the
// page asks of it is part of what the page decides — the height it gets, and
// the chrome it drops — so the stub keeps all of it readable.
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({
    children,
    wrapperClassName,
    hideMenu,
    hideChatDock,
  }: {
    children: ReactNode
    wrapperClassName?: string
    hideMenu?: boolean
    hideChatDock?: boolean
  }) => (
    <div
      data-testid="dashboard-wrapper"
      className={wrapperClassName}
      data-hide-menu={String(Boolean(hideMenu))}
      data-hide-chat-dock={String(Boolean(hideChatDock))}
    >
      {children}
    </div>
  ),
}))
vi.mock('app/dashboard/shared/useDistrictResolution', () => ({
  useDistrictResolution: () => districtResolution,
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => organization.current,
}))
// Real state rather than a null stub: the walk covers the map with its own
// sheet, so anything the page has to reset on the way out needs a session the
// test can actually start and end.
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
          return walkSession.doorsLogged
        },
        recordDoor: vi.fn(),
      }
    },
  }
})

// A ring around dot 0 only, so person 3 falls outside the list.
const turf: DoorKnockingTurf = {
  id: 1,
  outreachId: 900,
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
  // Every count is a real number from the moment a list exists: the create
  // transaction buys the route, so the frozen doors are counted before
  // anything sees the row.
  doorCount: 2,
  peopleCount: 3,
  loggedCount: 0,
  knockedDoorCount: 0,
  routeSeconds: 1860,
  completed: false,
  archivedAt: null,
  createdAt: new Date('2026-07-21T00:00:00Z'),
  updatedAt: new Date('2026-07-21T00:00:00Z'),
}

type PageProps = Partial<ComponentProps<typeof NativeDoorKnockingPage>>

const page = (props: PageProps = {}) => (
  <NativeDoorKnockingPage
    pathname="/dashboard/door-knocking"
    campaign={null}
    {...props}
  />
)

// The walk's sheet. It shares `aside[data-snap]` with the create flow's turf
// panel — both are the same snap-sheet object over the same map — but the two
// are never on screen together, because one belongs to a walk and the other
// to the create flow. The panel carries an accessible name and is queried by
// it below; this stays a bare selector because the walk's sheet is named by
// the turf it is walking and so has no fixed one.
const walkSheet = () => document.querySelector('aside[data-snap]')
const walkSurface = () => within(walkSheet() as HTMLElement)

// The create flow's turf panel: the campaign's turfs, and the selected one's
// colour and canvasser. Beside the map at `lg`, over it below.
const turfPanel = () => screen.getByRole('complementary', { name: 'Turfs' })

// The turf points at saved filter 7, so the default is that list existing with
// no options set — a real list that legitimately targets everyone inside its
// ring.
const renderPage = (
  props: PageProps = {},
  savedLists: SegmentResponse[] = [{ id: 7 }],
) => {
  api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [turf] })
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    data: savedLists,
  })
  return render(page(props))
}

// The whole create flow is gated on the pack, so every test that walks it
// waits for the map the pack draws first.
const mapReady = () => screen.findByTestId('voter-map')

// The draw step's own count line. Matched on the paragraph's whole text
// because each number sits in its own `<span>`.
// The draw step lists the campaign's turfs, so what it reports about a
// drawn shape is a card naming that turf. It used to be one paragraph of
// "N matching households · M selected households", which described a single
// boundary — the thing this step stopped being about.
// The draw step's cards are the same component the panel draws, but never
// open and never selectable there — a turf's name, colour and canvasser are
// all set on the surface that cuts it — so the name is plain text rather
// than the accessible name of a row button.
const drawnTurfCard = (name: string) => screen.findByText(name)

// A turf is named before it is drawn now: the card for the one being cut is
// open from the moment the drawing surface is, and its name is what the
// draft is stamped with when a third corner lands. No turf is auto-named,
// so a test that wants to find one by name has to give it one first.
// The panel opens on an empty state whose whole job is "find the place
// first" — no card, no Add turf, Save disabled. Pressing this is what
// brings the drawing controls, and only the FIRST turf of a session has
// one to press.
const drawFirstTurf = () => {
  const cta = screen.queryByRole('button', { name: /Draw the first turf/ })
  if (cta) fireEvent.click(cta)
}

const nameThisTurf = (name: string) => {
  fireEvent.change(screen.getByLabelText('Turf name'), {
    target: { value: name },
  })
  fireEvent.blur(screen.getByLabelText('Turf name'))
}

// The who step's CTA carries the audience it is about to continue with, so it
// is matched on the word rather than on the count — which is the fixture's
// households and not what any of these tests are about.
const continueFromWho = () =>
  screen.getByRole('button', { name: /^Continue \(/ })

// Walking the flow the page opened for us to the draw step. The create flow
// has two pre-draw steps — a goal card, then the audience — and both live
// inside the page's single `filters` step, so the transition these tests are
// actually about (filters → draw, the one that starts a drawing session) is
// unchanged. Reaching it is a goal card, a picked audience, and Continue.
// Picking the audience is required because Continue now gates on
// hasPickedAudience.
const openFlowAndDraw = async () => {
  // Walk the create flow from purpose to the draw step. The step order is
  // purpose → who → points → name → draw → route (see
  // createFlow/createFlowSteps.ts). Every Continue below advances one
  // stage; the name step also needs a typed campaign name to enable its
  // Continue.
  fireEvent.click(
    await screen.findByRole('button', { name: /Introduce myself/ }),
  )
  fireEvent.click(await audiencePicker())
  fireEvent.click(await screen.findByRole('option', { name: /All contacts/ }))
  fireEvent.click(continueFromWho())
  // points → name
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
  // name step: type a campaign name so its Continue enables, then advance
  // to draw.
  fireEvent.change(await screen.findByLabelText('Campaign name'), {
    target: { value: 'Test campaign' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

// Cutting a shape and coming back to the step that frames it, which is the way
// a candidate reaches the counts and the addresses: the drawing surface is the
// map and the way forward from it and carries neither, and Back off the confirm
// step returns the draw step exactly as it was left. The drawing surface's
// instructions AlertDialog opens on every mount and inerts the map behind it,
// so it has to be dismissed before any tap can reach the canvas.
const drawRingAndReview = async (turfName = 'Turf 1') => {
  fireEvent.click(
    screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
  )
  const tapMap = screen.getByRole('button', { name: 'tap the map' })
  // Named before the first corner, which is the order the surface now asks
  // in — and without it the turf has no name for anything downstream to
  // find it by.
  drawFirstTurf()
  nameThisTurf(turfName)
  fireEvent.click(tapMap)
  fireEvent.click(tapMap)
  fireEvent.click(tapMap)
  // Save turf(s) closes the drawing surface and hands back to the step that
  // lists what was cut — it does not advance the flow, because drawing is a
  // place a candidate returns to until the campaign is divided the way they
  // want it.
  fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
}

// The picker on the who step, which is a listbox rather than a stack of radio
// cards — so what a test can read off it is the row it is resting on.
const audiencePicker = () =>
  screen.findByRole('combobox', { name: 'All lists' })

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
      // One door on a street, so the address IS the stop's line and there is no
      // unit under it. These tests are about the two surfaces numbering one
      // stop the same way, not about buildings.
      unit: '',
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

// Into a walk on the one saved list. `?walkTurfId=` is the way in — the
// outreach hub's "Continue knocking" — and now the only one that does not
// involve building a list first: the rail card's Knock went with the rail.
const startWalk = async (
  stops = [
    walkStop(11, 1, '105 Elm St', 'Dorian Fen'),
    walkStop(12, 2, '210 Cedar Row', 'Marisol Vega'),
  ],
  props: PageProps = {},
) => {
  api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [turf] })
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    data: [{ id: 7 }],
  })
  api.mock('GET /v1/door-knocking/turfs/:id/route', {
    status: 200,
    data: routePayloadOf(stops),
  })
  render(page({ walkTurfId: 1, ...props }))
  return screen.findByRole('button', { name: 'tap pin 11' })
}

// The walk's one way out, which is the "Close route" button in its own
// sheet header. PersonSheet's close is labelled "Close person details",
// so this can only be the walk's.
const leaveWalk = () =>
  fireEvent.click(walkSurface().getByRole('button', { name: 'Close route' }))

// The hubs door knocking is entered from and every exit from it lands on —
// one per surface, because one route serves both.
const OUTREACH_HUB = '/dashboard/outreach'
const SERVE_HUB = '/dashboard/constituent-outreach'

// Every test gets an org with room to build, because the daily allowances are
// a gate on opening the create flow and almost nothing in this file is about
// them. The four tests that ARE override it.
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSnackbar).mockReturnValue({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
  } as unknown as ReturnType<typeof useSnackbar>)
  districtResolution.isUnresolvable = false
  packSource.failed = false
  packSource.held = null
  packSource.fetches = 0
  walkSession.doorsLogged = 0
  drawSession.placed = []
  // No org, so no `electedOfficeId`: every test in this file is a Win surface
  // unless it says otherwise, which is what `campaign={null}` already implied
  // before Serve could reach this page at all.
  organization.current = null
  // Fires as soon as the create flow opens. Answered so it never reaches the
  // network: left unhandled it passes through, fails, and retries on a ~1s
  // backoff, re-rendering the who step partway through a test. Precinct
  // itself is covered by PrecinctFilter and usePrecinctOptions.
  api.mock('GET /v1/contacts/precincts', {
    status: 200,
    data: { options: [], truncated: false },
  })
})

describe('NativeDoorKnockingPage voter map', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  // Left to fitBounds the map opens at district zoom, where there is nothing
  // to orient against. 16 is where street names appear.
  it('opens the map at street-level zoom', async () => {
    renderPage()

    expect(await mapReady()).toHaveAttribute('data-initial-zoom', '16')
  })

  // Removed: `visibleTurfs` gate tightened — saved turfs render only during a
  // walk (only the walked turf), and never during the create flow. The
  // landing state this test asserted no longer exists.

  // The pack and every turf read resolve a district server-side, so without one
  // they can only 400 — and a boundary cannot be drawn against a district we
  // cannot identify. The message goes BEFORE the pending branch on purpose: a
  // district-gated query is neither pending-with-a-request nor errored, so that
  // branch would spin forever behind it.
  it('says voter data is missing rather than spinning, with no district', async () => {
    districtResolution.isUnresolvable = true
    renderPage()

    expect(
      await screen.findByText(
        /Voter data is not available for this office yet/,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Loading...')).toBeNull()
    expect(screen.queryByTestId('voter-map')).toBeNull()
    // And nothing opens: the flow the page arrives asking for has no map to
    // draw a turf on.
    expect(screen.queryByText(/Introduce myself/)).toBeNull()
  })

  // The map-region pack loader is gone — the walk drawer's own MapLoader
  // owns the wait when a walk is being entered, and the create flow's
  // in-sheet copy owns it otherwise. Pack pending with no walk being
  // entered now shows nothing behind the surface on top; the wait UX
  // lives on whichever surface the candidate is actually watching.

  // A refresh is the whole remedy, and it is the honest one: the pack is a
  // single decoded blob, so there is no partial map to fall back to.
  it('says the map failed rather than drawing an empty district', async () => {
    packSource.failed = true
    renderPage()

    expect(
      (
        await screen.findAllByText(
          'The voter map could not load. Refresh to try again.',
        )
      ).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByTestId('voter-map')).toBeNull()
  })
})

// The complaint this page was reported with: "the counts take forever, and that
// amount of lag with nothing communicated to the user is unacceptable". Both
// halves are the same fact — the who step's count is arithmetic over the pack,
// so it reads 0 until a district that takes 5-30 seconds has downloaded, and
// the only surface saying so was the map region this sheet is drawn over.
describe('NativeDoorKnockingPage create flow while the pack loads', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  const holdPack = () => {
    let release: () => void = () => undefined
    packSource.held = new Promise<void>((resolve) => {
      release = resolve
    })
    return async () => {
      await act(async () => {
        release()
      })
    }
  }

  // The Win/Serve wording divergence used to be asserted on the map-region
  // loader's caption. That surface is gone — the walk drawer's MapLoader
  // says "Loading your route" for both rails (the walk is the surface, not
  // the map), and the create flow's in-sheet copy still carries the
  // serveMode-derived wording where it matters. The invariant lives in
  // the pack-error and district-unavailable messages here and in
  // CreateListFlow's sheet copy.

  // `Continue (0)` is not a pending state. It is a real-looking number, and the
  // only reading available for it — this district has nobody in it — is the
  // opposite of the truth.
  it('never puts a zero in the who step’s button while the count is pending', async () => {
    const release = holdPack()
    renderPage()

    fireEvent.click(
      await screen.findByRole('button', { name: /Introduce myself/ }),
    )

    const cta = screen.getByRole('button', { name: 'Continue' })
    expect(cta).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Continue \(0\)/ })).toBeNull()

    await release()

    // The candidate now picks the audience — Continue gates on
    // hasPickedAudience — so the count returns as the honest fixture size.
    fireEvent.click(await screen.findByRole('combobox', { name: 'All lists' }))
    fireEvent.click(await screen.findByRole('option', { name: /All contacts/ }))

    // And the count arrives in it once there is one: the fixture's district is
    // three households.
    expect(
      await screen.findByRole('button', { name: 'Continue (3)' }),
    ).toBeInTheDocument()
  })

  // Removed: "Loading your voter map…" no longer sits inside the who step
  // sheet (design change — Continue button's own loading spinner is now the
  // only pack-pending signal on this step).

  // `retry: 0` makes a failed pack final, so without this the step is a
  // permanently disabled button with the reason hidden behind it.
  it('surfaces a failed pack in the sheet rather than only behind it', async () => {
    packSource.failed = true
    renderPage()

    fireEvent.click(
      await screen.findByRole('button', { name: /Introduce myself/ }),
    )

    // Awaited rather than asserted outright: the flow opens on arrival now
    // that nothing gates it on a quota read, so the sheet can be on screen
    // before the pack query has finished failing.
    const sheet = screen.getByRole('dialog')
    expect(
      await within(sheet).findByText(
        'The voter map could not load. Refresh to try again.',
      ),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByRole('button', { name: 'Continue' }),
    ).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Continue \(0\)/ })).toBeNull()
  })
})

describe('NativeDoorKnockingPage create flow', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  // Arriving here IS asking to build a campaign. There is no landing surface to
  // choose from any more, so the flow opens itself however the page was
  // reached.
  it('opens the create flow on arrival', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    render(page())

    expect(await screen.findByText(/Introduce myself/)).toBeInTheDocument()
  })

  // The opener no longer looks at the turf list at all, which is the change:
  // it used to be a zero-state opener, so an org with lists of its own landed
  // on a rail instead. There is no rail to land on, and an org that already
  // knocks is exactly the org that came here to build the next walk.
  it('opens the create flow for an org that already has lists', async () => {
    renderPage()

    expect(await screen.findByText(/Introduce myself/)).toBeInTheDocument()
  })

  // `?create=1` is the outreach hub's door-knocking tile. Back rather than a
  // path, because the tile exists on the Win hub and the Serve one and this
  // page cannot tell which of them sent it — pushing a guess would take a
  // Serve org to the Win hub on a changed mind, and `back()` keeps the hub's
  // scroll position either way.
  it('pops the history entry when the tile’s flow is dismissed', async () => {
    renderPage({ openCreateFlow: true })
    await screen.findByText(/Introduce myself/)

    // Nothing picked, so the X is not a question.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(router.back).toHaveBeenCalled())
    expect(router.push).not.toHaveBeenCalled()
  })

  // A typed URL or a bookmark has no history entry to pop, so it gets the hub
  // outright. Closing to the map behind would strand the candidate on a bare
  // district with no surface on it and no control to make one.
  it('leaves door knocking when a direct visit’s flow is dismissed', async () => {
    renderPage()
    await screen.findByText(/Introduce myself/)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(OUTREACH_HUB))
    expect(router.back).not.toHaveBeenCalled()
  })

  // The far end of the outreach hub's door-knocking tile. The whole chain is
  // asserted here — page prop through the surface into the flow's own picker
  // — because every link in it is a plain pass-through and a pass-through is
  // exactly what a refactor drops without failing a unit test.
  it('opens the create flow on the list carried in on ?listId=', async () => {
    renderPage({ preselectedListId: 8 }, [
      { id: 7, name: 'Precinct 2 homeowners' },
      { id: 8, name: 'Super voters', partyDemocrat: true },
    ])

    fireEvent.click(
      await screen.findByRole('button', { name: /Introduce myself/ }),
    )

    expect(await audiencePicker()).toHaveTextContent('Super voters')
    expect(await audiencePicker()).not.toHaveTextContent('All contacts')
    // The list's own filters reached the draft, so the map under the step is
    // shading the audience the walk will actually be cut from: one of the
    // fixture's four people is Democratic.
    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-people',
        '1',
      ),
    )
  })

  // The same chain for a recommended variant: page prop through the surface
  // into the flow, which asks for it on door knocking and applies it.
  it('opens the create flow on the recommendation carried in on ?recommended=', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', ({ query }) => ({
      status: 200,
      data:
        query.variant === 'persuadeAffinity'
          ? [
              {
                variant: 'persuadeAffinity',
                intent: 'persuade',
                filter: { voterStatus: ['Super', 'Likely'] },
                count: 3,
                copy: {
                  title: 'Persuadable independents',
                  criteriaSummary: 'Moderate to high propensity independents',
                },
                existingFilterId: null,
              },
            ]
          : [],
    }))
    renderPage({ preselectedRecommendedVariant: 'persuadeAffinity' }, [
      { id: 7, name: 'Precinct 2 homeowners' },
    ])

    // The card answered the goal question, so the flow opens on the who
    // stage with no goal cards to press.
    expect(
      await screen.findByTestId('recommended-list-card'),
    ).toHaveTextContent('Persuadable independents')
    expect(
      screen.queryByRole('button', { name: /Introduce myself/ }),
    ).toBeNull()
    // Applied, not merely offered: the draft carries the universe's bands.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^Continue \(/ }),
      ).toBeEnabled(),
    )
  })

  // A stale bookmark, a list deleted in the CRM since, or another org's id:
  // the param is not trusted, so all of them are a missed preselection and
  // nothing else. The picker now reads its placeholder rather than defaulting
  // to All contacts, so a bad id lands as "nothing picked yet".
  it('opens the ordinary create flow when the carried list is not one of yours', async () => {
    renderPage({ preselectedListId: 12_345 }, [
      { id: 7, name: 'Precinct 2 homeowners' },
    ])

    fireEvent.click(
      await screen.findByRole('button', { name: /Introduce myself/ }),
    )

    expect(await audiencePicker()).toHaveTextContent('Choose a voter list')
    expect(await audiencePicker()).not.toHaveTextContent(
      'Precinct 2 homeowners',
    )
  })

  // The bug the once-guard is never unset for, walked end to end. The create
  // transaction invalidates the allowance, and the allowance answering again
  // re-runs the landing effect — so re-arming the guard when a list was
  // created reopened the flow at step one on top of the walk that had just
  // started, against a turf list that had not refetched yet.
  // The panel opens on an invitation to find the place, not on a card and a
  // live Save: a boundary cannot be drawn before the map has been moved
  // anywhere, and offering the controls first asks for one.
  it('opens the drawing panel on an empty state, with no card and no live Save', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })
    render(page())
    await mapReady()

    await openFlowAndDraw()
    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )

    const panel = () => within(turfPanel())
    expect(
      await panel().findByText(/Navigate the map to the location/),
    ).toBeInTheDocument()
    // Save stays live — leaving without cutting anything is a real exit.
    expect(panel().getByRole('button', { name: 'Save' })).toBeEnabled()
    // Absent rather than disabled: there is nothing to add a turf to yet.
    expect(panel().queryByRole('button', { name: /Add turf/ })).toBeNull()
    expect(panel().queryByLabelText('Turf name')).toBeNull()

    fireEvent.click(
      panel().getByRole('button', { name: /Draw the first turf/ }),
    )

    // The press brings all three at once.
    expect(panel().getByLabelText('Turf name')).toBeInTheDocument()
    expect(
      panel().getByRole('button', { name: /Add turf/ }),
    ).toBeInTheDocument()
    expect(panel().getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(panel().queryByText(/Navigate the map to the location/)).toBeNull()
  })

  // The other half of the reported bug. Undo blanks a draft rather than
  // deleting it, so taking every point back used to hand a card with
  // nothing in it to the draw step. Leaving is still allowed — what must
  // not survive is the empty draft.
  it('saves with nothing drawn, and leaves no turf behind', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })
    render(page())
    await mapReady()

    await openFlowAndDraw()
    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )
    drawFirstTurf()

    // Straight out again, having cut nothing.
    fireEvent.click(within(turfPanel()).getByRole('button', { name: 'Save' }))

    // Back on the draw step with no card on it — the surface is gone and
    // nothing took its place.
    await waitFor(() => expect(screen.queryByText('Turfs')).toBeNull())
    expect(screen.queryByText(/Name this turf/)).toBeNull()
    expect(screen.queryByText('Drawing')).toBeNull()
  })

  it('throws away the turf being cut, and goes back to the empty state', async () => {
    // Undo takes back one corner at a time and cannot take back the turf,
    // so a candidate who started one by mistake needs a control of their
    // own — and pressing it on the only turf leaves an empty panel, which
    // is exactly the state the empty state was written for.
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })
    render(page())
    await mapReady()

    await openFlowAndDraw()
    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )
    drawFirstTurf()

    // Two corners down: a turf with no draft behind it, which is the case
    // that had nothing to press.
    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)

    const panel = () => within(turfPanel())
    fireEvent.click(panel().getByRole('button', { name: 'Delete this turf' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(
      await panel().findByText(/Navigate the map to the location/),
    ).toBeInTheDocument()
    expect(panel().queryByLabelText('Turf name')).toBeNull()
    expect(panel().queryByText('Drawing')).toBeNull()
  })

  it('parks the unfinished turf as a card of its own when another is added', async () => {
    // `Add turf` has to add one. On a turf that had not reached its third
    // corner it did nothing a candidate could see: the card on the panel
    // was the pending one, and the press replaced it with an identical
    // pending one.
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })
    render(page())
    await mapReady()

    await openFlowAndDraw()
    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )
    drawFirstTurf()
    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)

    const panel = () => within(turfPanel())
    fireEvent.click(panel().getByRole('button', { name: /Add turf/ }))

    // The one left behind is a card, red, naming both halves it is short
    // of — and it is no longer the one being drawn.
    expect(await panel().findByRole('alert')).toHaveTextContent(
      'Draw and name this turf',
    )
    expect(panel().getByText('Not drawn')).toBeInTheDocument()
    // The new one is open and under the cursor.
    expect(panel().getByText('Drawing')).toBeInTheDocument()

    // And Save will not take a card that cannot become a turf.
    fireEvent.click(panel().getByRole('button', { name: 'Save' }))
    expect(panel().getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Turfs')).toBeInTheDocument()
  })

  it('keeps a named turf that is still being cut when another is selected', async () => {
    // Reported from the app: name the turf you are cutting, click a
    // different turf, and the named one is gone — its card only existed
    // while it was the one under the cursor.
    renderPage()
    await mapReady()

    await openFlowAndDraw()
    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )
    drawFirstTurf()
    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    nameThisTurf('Turf 1')
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)

    // A second turf, named but not yet drawn.
    fireEvent.click(
      within(turfPanel()).getByRole('button', { name: /Add turf/ }),
    )
    nameThisTurf('Turf 2')

    // Back to the first one.
    fireEvent.click(
      await within(turfPanel()).findByRole('button', { name: /^Turf 1/ }),
    )

    // Turf 2 survives as a card of its own, closed, saying what it needs.
    expect(
      await within(turfPanel()).findByRole('button', { name: /^Turf 2/ }),
    ).toBeInTheDocument()
    expect(within(turfPanel()).getByRole('alert')).toHaveTextContent(
      'Draw this turf',
    )
  })

  it('keeps an untouched turf being cut when another is selected', async () => {
    // The second half of the same report. A card on this panel is a turf
    // the candidate started — they pressed Add turf to get it — so an
    // empty one is no more disposable than a named one, and the only
    // thing that takes a card off the panel is delete.
    renderPage()
    await mapReady()

    await openFlowAndDraw()
    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )
    drawFirstTurf()
    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    nameThisTurf('Turf 1')
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)

    fireEvent.click(
      within(turfPanel()).getByRole('button', { name: /Add turf/ }),
    )
    // Nothing typed, nobody assigned, no corner placed.
    fireEvent.click(
      await within(turfPanel()).findByRole('button', { name: /^Turf 1/ }),
    )

    expect(
      await within(turfPanel()).findByText('Not drawn'),
    ).toBeInTheDocument()
    expect(within(turfPanel()).getByRole('alert')).toHaveTextContent(
      'Draw and name this turf',
    )
  })

  it('hands the cursor back to the turf before the one deleted', async () => {
    // Reported from the app: delete the second of two turfs and the turf
    // and its name go, but an empty card is left behind. The turf being
    // cut IS a card, so handing the canvas a fresh session on delete added
    // one at the moment a turf was removed.
    renderPage()
    await mapReady()

    await openFlowAndDraw()
    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )
    drawFirstTurf()
    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    nameThisTurf('Turf 1')
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)

    fireEvent.click(
      within(turfPanel()).getByRole('button', { name: /Add turf/ }),
    )
    nameThisTurf('Turf 2')
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    expect(
      await within(turfPanel()).findByDisplayValue('Turf 2'),
    ).toBeInTheDocument()

    fireEvent.click(
      within(turfPanel()).getByRole('button', { name: 'Delete Turf 2' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    // Turf 1 is under the cursor again — open, so its name is a value —
    // and nothing blank was left in its place.
    expect(
      await within(turfPanel()).findByDisplayValue('Turf 1'),
    ).toBeInTheDocument()
    expect(within(turfPanel()).queryByText('Drawing')).toBeNull()
    expect(within(turfPanel()).queryByText('Not drawn')).toBeNull()
  })

  // The reported bug: draw three points, undo them all, press Save. Undo
  // BLANKS a draft rather than deleting it, so what was left was a turf
  // with no name and no shape — and Save took it, because the only thing
  // it ever checked was the stop cap.
  it('refuses to save a turf that is missing its name, and says so on the card', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })
    render(page())
    await mapReady()

    await openFlowAndDraw()
    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )
    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)

    fireEvent.click(within(turfPanel()).getByRole('button', { name: 'Save' }))

    // Still on the drawing surface, and the card says what it is short of.
    expect(await within(turfPanel()).findByRole('alert')).toHaveTextContent(
      'Name this turf',
    )

    // Naming it clears that card's error with no second press, because the
    // problem is derived from the draft rather than stored on the attempt.
    nameThisTurf('Ward 4')
    await waitFor(() =>
      expect(within(turfPanel()).queryByRole('alert')).not.toBeInTheDocument(),
    )
  })

  it('does not reopen the flow when creating a campaign refetches the rail', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 9 },
    })
    api.mock('POST /v1/door-knocking/turfs', {
      status: 200,
      data: {
        ...turf,
        id: 5,
        outreachId: 77,
        voterFileFilterId: 9,
        name: 'Introduction walk',
        color: '#2563eb',
        doorCount: 12,
        peopleCount: 20,
        loggedCount: 0,
        routeSeconds: null,
      },
    })
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayloadOf([walkStop(11, 1, '105 Elm St', 'Dorian Fen')]),
    })
    render(page())
    await mapReady()

    await openFlowAndDraw()
    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )
    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    drawFirstTurf()
    nameThisTurf('Turf 1')
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    // Back to the draw step with one turf on it, then on to the route. The
    // campaign was already named by `openFlowAndDraw` — the name step sits
    // before the polygon now, because the campaign is the container the
    // turfs are cut into.
    // Back to the draw step with one turf on it, then the press that writes
    // the campaign. The campaign was already named by `openFlowAndDraw` —
    // the name step sits before the polygon, because the campaign is the
    // container the turfs are cut into.
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create campaign' }),
    )

    // The flow ends on its own screen rather than handing over to a walk:
    // nothing has bought a route, so there is nothing to walk yet.
    expect(
      await screen.findByText('Your campaign is ready'),
    ).toBeInTheDocument()

    // The rail refetching behind it, which is what the create's own
    // invalidation does. It must not re-fire the landing opener and drop the
    // candidate back into step one of the flow they just finished.
    await act(async () => {
      await testQueryClient.invalidateQueries({ queryKey: TURFS_QUERY_KEY })
    })

    expect(screen.getByText('Your campaign is ready')).toBeInTheDocument()
    expect(screen.queryByText(/Introduce myself/)).toBeNull()
  })

  // Three discriminators live on this page and they are NOT interchangeable.
  // `serveMode` decides which rail's lists are on screen and lets a Campaign
  // win; the Win-only filter groups are hidden off the `eo-` slug prefix
  // instead, because that is the rule gp-api's own gate reads
  // (`ContactsService.hasElectedOfficeAccess`) and a filter it will 400 must
  // not be offered on either surface. This fixture is the case that tells them
  // apart: an `eo-` org holding a live Campaign, which is Win by `serveMode`
  // and still an elected office to every request it makes.
  const openFilterFace = async () => {
    fireEvent.click(
      await screen.findByRole('button', { name: /Introduce myself/ }),
    )
    // The pills are the who step's second face, behind the picker's "Create a
    // new list" row.
    fireEvent.click(await audiencePicker())
    fireEvent.click(screen.getByRole('button', { name: /Create a new list/ }))
  }

  it('hides the Win-only filters for an eo- org that also holds a campaign', async () => {
    organization.current = { slug: 'eo-city-council', electedOfficeId: 9 }

    renderPage()
    await openFilterFace()

    expect(screen.queryByLabelText('Political Party')).toBeNull()
    expect(screen.queryByLabelText('Voter Likelihood')).toBeNull()
    expect(screen.queryByLabelText('Prior Contacts Made')).toBeNull()
    // The control, so the absences above are the Win-only rule rather than a
    // face of the step that never opened.
    expect(screen.getByLabelText('Gender')).toBeTruthy()
  })

  // The mirror, and the one the old `electedOfficeId` read got wrong: a
  // campaign org that has picked up an ElectedOffice row without the slug that
  // makes it a Serve org keeps every filter, because gp-api will honour them.
  it('keeps them for a campaign-slug org holding an elected office', async () => {
    organization.current = { slug: 'campaign-mayor', electedOfficeId: 9 }

    renderPage()
    await openFilterFace()

    expect(screen.getByLabelText('Political Party')).toBeTruthy()
    expect(screen.getByLabelText('Voter Likelihood')).toBeTruthy()
  })
})

// This page is a full-bleed map with a floating card over it, which only works
// if the DOCUMENT is exactly the height the dashboard chrome leaves and all the
// scrolling happens inside the card. jsdom has no layout, so these assert the
// height contract rather than its effect — the rendered proof (no page scroll
// at 1440×900 and 390×844, with and without the campaign-manager chat bar) is
// in the PR's screenshots.
describe('NativeDoorKnockingPage page chrome', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  // The wrapper is `flex-1` inside two more flex boxes, and a flex item's
  // default `min-height: auto` lets its content set the floor. Without
  // `min-h-0` anything the layout renders beside this page pushed the document
  // past the window — which is exactly what happened: the campaign-manager
  // chat's in-flow `h-24` spacer scrolled the map by 96px.
  it('asks the layout for a wrapper that cannot be pushed past the window', async () => {
    renderPage()
    await mapReady()

    const wrapper = screen.getByTestId('dashboard-wrapper')
    expect(wrapper).toHaveClass('min-h-0', 'overflow-hidden', 'flex-col')
  })

  // It used to be `h-[calc(100dvh-4rem)]`, hard-coding the mobile top bar's
  // height. That bar is `lg:hidden`, so above `lg` it subtracted a bar that
  // was not there and the map stopped 64px short of the bottom of the window
  // on every desktop. Filling the wrapper is right at every width, because
  // measuring the chrome is the layout's job and not this page's.
  it('fills that wrapper instead of guessing the chrome above it', async () => {
    renderPage()
    await mapReady()

    const column = screen.getByTestId('dashboard-wrapper')
      .firstElementChild as HTMLElement
    expect(column.className.split(/\s+/)).toContain('h-full')
    expect(column.className).not.toContain('100dvh')
  })

  // Door knocking is a modal over the outreach hub in the design: no nav rail,
  // no page title over the map. It is reached from that hub's tile and returns
  // there from every exit, so the sidebar the layout would offer leads back
  // where the close button already goes. Dropped here rather than by rendering
  // outside `DashboardLayout`, which would cost the tree its providers.
  it('drops the dashboard menu rather than the layout around it', async () => {
    renderPage()
    await mapReady()

    expect(screen.getByTestId('dashboard-wrapper')).toHaveAttribute(
      'data-hide-menu',
      'true',
    )
  })

  // The campaign-manager dock is a fixed bar across the bottom of the window,
  // and the bottom of the window is where the walk logs a knock: `PersonSheet`
  // ends in `RecordKnockForm`'s "Did they answer?" ladder and
  // `NotAVoterControl`, and the dock sat on top of them — the canvasser at the
  // door had no control to record the answer with. Restacking cannot reach it
  // either, the sheet being `fixed z-40` inside `WalkSurface`'s `absolute
  // z-20`. Its own prop and not `hideMenu`: the four other routes that hide
  // the menu keep the manager.
  it('drops the chat dock too, because the walk owns the bottom of the window', async () => {
    renderPage()
    await mapReady()

    expect(screen.getByTestId('dashboard-wrapper')).toHaveAttribute(
      'data-hide-chat-dock',
      'true',
    )
  })
})

describe('NativeDoorKnockingPage draw step', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  // The whole draw step as a canvasser meets it: no Done button anywhere, a
  // three-point minimum nothing on the button names, and a way forward that
  // only opens once the canvas has a ring to hand over.
  it('walks filters → three taps → confirm', async () => {
    renderPage()
    await mapReady()

    await openFlowAndDraw()

    // The step frames the map behind a shielded window, so cutting the shape
    // is its own surface: the map with nothing over it but the way forward.
    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )

    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    drawFirstTurf()
    nameThisTurf('Turf 1')
    const save = () => within(turfPanel()).getByRole('button', { name: 'Save' })
    // Nothing over the map before the first point: the instructions dialog
    // has just named the gesture and the panel names the turf. Save is live
    // throughout — leaving a surface you are standing on is never the thing
    // to block.
    expect(screen.queryByText(/Tap or click the map/)).toBeNull()
    expect(save()).toBeEnabled()

    fireEvent.click(tapMap)
    // The count pill and Undo moved into maplibre's control cluster, which
    // this suite stubs — `VoterMapCanvas.test.tsx` owns them now.

    fireEvent.click(tapMap)

    // The canvas closes the shape itself on the third tap rather than waiting
    // for a finish gesture, and that is also the moment the turf becomes a
    // draft — so it is the moment the panel beside the map gains a row for
    // it.
    fireEvent.click(tapMap)
    // The open card's name is an input, so it is a VALUE and not text —
    // `findByText` cannot see it.
    expect(
      await within(turfPanel()).findByDisplayValue('Turf 1'),
    ).toBeInTheDocument()

    fireEvent.click(save())

    // Back on the step that lists the campaign's turfs, with the one just
    // cut on it — not forward into the flow.
    expect(await drawnTurfCard('Turf 1')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Draw another turf' }),
    ).toBeInTheDocument()
  })

  // The seam this crosses: the ring is drawn by the canvas, the canvas outlives
  // the flow, and so the camera request and the colour the boundary is drawn in
  // both travel up to the page and back down as canvas props. The two states of
  // the one map are what the flow switches between — a shielded preview window
  // on the step, and the uncovered drawing surface — so the page is what has to
  // know which of the two the map is currently in.
  it('frames the shape when the drawing surface uncovers the map', async () => {
    renderPage()
    await mapReady()

    await openFlowAndDraw()

    const map = screen.getByTestId('voter-map')
    // The step's preview window is a picture with a shield over it, so the
    // map's own buttons standing in it would be ones that answer nothing.
    expect(map).toHaveAttribute('data-controls-hidden', 'true')
    expect(map).toHaveAttribute('data-frame', '0')
    // Assigned rather than picked — the confirm step is a single name field —
    // but still the page's, because the canvas is what tints the ring with it.
    expect(map).toHaveAttribute('data-draw-color', '#2563eb')

    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )

    // Uncovering the map asks for the shape back in view: the camera has not
    // moved, but a candidate who has been reading a step has no idea where
    // their boundary is. Fitted into the whole of it, because nothing covers
    // the drawing surface.
    expect(map).toHaveAttribute('data-frame', '1')
    expect(map).toHaveAttribute('data-frame-bottom', '0')
    expect(map).toHaveAttribute('data-controls-hidden', 'false')

    // And back to the draw step. Cancel rather than Back now, and it does
    // not prompt: nothing was drawn in this session, so nothing is lost.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(map).toHaveAttribute('data-controls-hidden', 'true')
    expect(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    ).toBeVisible()
  })

  // Caught by running the app: the ring went GREEN the instant its third
  // corner landed. Committing the turf adds its colour to the campaign,
  // which moves the palette's next-free-slot answer on — and the ring was
  // reading that answer rather than its own turf's colour. So the shape on
  // screen wore the next turf's hue while its draft stayed blue, and the
  // card on the step behind disagreed with the map.
  //
  // A committed turf owns its colour. Only a turf that does not exist yet
  // takes the seed.
  it('keeps a drawn turf in its own colour once the palette moves on', async () => {
    renderPage()
    await mapReady()

    await openFlowAndDraw()
    const map = screen.getByTestId('voter-map')
    // Nothing drawn: the ring wears the slot the next turf will take.
    expect(map).toHaveAttribute('data-draw-color', TURF_COLORS[0])

    await drawRingAndReview()

    // Still the first slot, though the campaign now holds a turf wearing it.
    expect(map).toHaveAttribute('data-draw-color', TURF_COLORS[0])
    await drawnTurfCard('Turf 1')
  })

  // Cancel is the only word on this surface that throws anything away, and
  // what it throws away is THIS SESSION — not the campaign.
  it('puts the turfs back the way the session found them', async () => {
    renderPage()
    await mapReady()

    await openFlowAndDraw()
    // Session one: cut a turf and keep it.
    await drawRingAndReview()
    await drawnTurfCard('Turf 1')

    // Session two: cut a second, then change your mind. Reopening the map
    // resumes the turf that was being drawn rather than starting one, so
    // the second turf begins with Add turf — the same press a candidate
    // makes.
    fireEvent.click(screen.getByRole('button', { name: 'Draw another turf' }))
    fireEvent.click(
      within(turfPanel()).getByRole('button', { name: /Add turf/ }),
    )
    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    drawFirstTurf()
    nameThisTurf('Turf 2')
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    // The open card's name is an input, so it is a VALUE and not text —
    // `findByText` cannot see it.
    expect(
      await within(turfPanel()).findByDisplayValue('Turf 2'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    // Something would be lost, so it asks — the prompt this button carries
    // is gated on the session having changed something.
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))

    // Turf 1 survives and Turf 2 is gone. Restoring to EMPTY here would
    // delete a turf the candidate cut in an earlier session and never asked
    // to lose, which is the whole reason the snapshot is per-session.
    expect(await drawnTurfCard('Turf 1')).toBeInTheDocument()
    expect(screen.queryByText('Turf 2')).toBeNull()
  })

  it('does not ask when a session with turfs already in it changed nothing', async () => {
    // Reported from the app: cut a turf, Save, press Draw another turf, then
    // Cancel straight away — and it asked what to discard, about a session
    // that had not touched anything. The sibling test below only covers a
    // session with NO turfs behind it, where nothing can be re-reported.
    renderPage()
    await mapReady()

    await openFlowAndDraw()
    await drawRingAndReview()
    await drawnTurfCard('Turf 1')

    fireEvent.click(screen.getByRole('button', { name: 'Draw another turf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText(/Discard/)).toBeNull()
    expect(await drawnTurfCard('Turf 1')).toBeInTheDocument()
  })

  it('leaves without asking when the session changed nothing', async () => {
    renderPage()
    await mapReady()

    await openFlowAndDraw()
    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )

    // Nothing drawn, so nothing to lose. The button this replaced used to
    // prompt on every press with any vertices down, for a gesture that
    // discarded nothing, and was removed for crying wolf.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText(/Discard/)).toBeNull()
    expect(
      await screen.findByRole('button', { name: 'Draw turfs' }),
    ).toBeInTheDocument()
  })

  // The cluster used to clear a hardcoded 96px, which was the drawing
  // surface's own 88px footer bar plus a gap. That bar moved into the turf
  // panel, so there is nothing on the map for the cluster to clear but the
  // panel itself — and only the panel knows how tall it is, so it reports.
  // Docked beside the map it covers nothing and reports the ordinary edge
  // gap; over the map as a sheet it reports its measured height.
  //
  // The locate button is offered here and only here inside the flow: a
  // boundary is cut standing on the street it covers as often as at a desk,
  // and knowing where you are is how you know which blocks to enclose.
  it('clears whatever the turf panel covers, with the full cluster on it', async () => {
    renderPage()
    await mapReady()

    await openFlowAndDraw()

    const map = screen.getByTestId('voter-map')
    expect(map).toHaveAttribute('data-controls-hidden', 'true')

    fireEvent.click(
      screen.getByRole('button', { name: /^Draw (turfs|another turf)$/ }),
    )

    expect(map).toHaveAttribute('data-controls-hidden', 'false')
    // The panel's own report rather than a number this page holds. jsdom
    // measures every element at zero height, so what is asserted is that the
    // report arrived at all — the 96 that used to be here was the one thing
    // this could no longer be.
    expect(map).not.toHaveAttribute('data-controls-bottom', '96')
    expect(map).toHaveAttribute('data-controls-bottom')
    expect(
      screen.getByRole('button', { name: 'Show my location' }),
    ).toBeInTheDocument()
  })

  // The regression this line shipped with once: two counts side by side, one
  // district-wide and one in-polygon, with nothing saying which was which. Both
  // are the page's — it owns the pack the polygon is measured against — so both
  // arriving right is a page-level fact.
  it('reports the district total and the drawn shape apart', async () => {
    renderPage()
    await mapReady()

    await openFlowAndDraw()
    await drawRingAndReview()

    // One turf, numbered across the campaign, with its own stop count —
    // the router's unit, and the one the cap is stated in.
    await drawnTurfCard('Turf 1')
    expect(screen.getByText(/stops/)).toBeInTheDocument()
    // And the CTA now offers the next one rather than the first.
    expect(
      screen.getByRole('button', { name: 'Draw another turf' }),
    ).toBeInTheDocument()
  })

  // Wired at the page level: the same over-cap boolean the create flow gates
  // Continue on flips the canvas's boundary hue to destructive red. This
  // asserts the false branch through the mock's data-draw-over-cap
  // attribute — the fixture pack has 2 dots so the shape is well under the
  // 150-stop cap and the flag must read false.
  it('tells the canvas the shape is not over cap on the normal path', async () => {
    renderPage()
    await mapReady()

    await openFlowAndDraw()
    await drawRingAndReview()

    expect(screen.getByTestId('voter-map')).toHaveAttribute(
      'data-draw-over-cap',
      'false',
    )
  })

  // Reported by QA as "the shapefile does not persist on Back". The ring
  // survived Back perfectly well; it was destroyed on the way FORWARD, because
  // `filters` → `draw` is the same transition whether it is a first arrival or
  // a return trip, and it unconditionally started a fresh drawing session.
  // Everything else in the draft — filters, purpose, saved list, name, mode —
  // survived, because both components stay mounted. The ring was the only
  // draft state actively thrown away.
  it('keeps the drawn shape across Back to the audience and forward again', async () => {
    renderPage()
    await mapReady()

    await openFlowAndDraw()
    await drawRingAndReview()
    await drawnTurfCard('Turf 1')

    const map = screen.getByTestId('voter-map')
    const startedWith = map.getAttribute('data-start-draw')

    // Back off the draw step lands on the campaign name, which is the step
    // before it now — and the far side of the transition at fault either
    // way: `changeFlowStep` arms drawing on arriving at `draw` from
    // anywhere, so every way back in runs the same branch.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByLabelText('Campaign name')).toHaveValue(
      'Test campaign',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Resumed rather than restarted: drawing mode is re-armed and the ring is
    // left alone.
    expect(map).toHaveAttribute('data-start-draw', startedWith!)
    expect(map).toHaveAttribute('data-resume-draw', '1')
    await drawnTurfCard('Turf 1')
  })

  // The other half of the same distinction: a first arrival still gets a
  // blank session, so resuming has not simply replaced starting.
  it('starts a fresh drawing session on the first arrival at the draw step', async () => {
    renderPage()
    await mapReady()

    await openFlowAndDraw()

    const map = screen.getByTestId('voter-map')
    expect(map).toHaveAttribute('data-start-draw', '1')
    expect(map).toHaveAttribute('data-resume-draw', '0')
  })

  // Removed: DoorsPanel / "See the addresses" toggle and the address-preview
  // panel are gone from the draw step (design change — draw step body is
  // counts row + Geoapify preview card only). The preview query is still
  // wired on the page but nothing on the draw step consumes it.
})

// `?walkTurfId=` is the outreach hub's "Continue knocking", and now the only
// deep link that opens a surface rather than the create flow. It waits on the
// turf query rather than starting from the id alone, because the walk's own
// header needs the list's name.
describe('NativeDoorKnockingPage walk deep link', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  it('starts the walk on the turf carried in on ?walkTurfId=', async () => {
    await startWalk()

    expect(walkSurface().getByText('Elm St & 5th')).toBeInTheDocument()
    // Stripped before the walk opens, by the same convention the hub's own
    // deep link follows: a back-navigation must not reopen a walk that was
    // closed.
    expect(router.replace).toHaveBeenCalledWith('/dashboard/door-knocking', {
      scroll: false,
    })
    // The two params ask for different things and only one surface can be on
    // screen, so the walk wins over the landing opener.
    expect(screen.queryByText(/Introduce myself/)).toBeNull()
  })

  // Consume-once, and the id is what records it rather than a boolean: the
  // effect waits on the turf list, so a refetch is exactly what would re-fire
  // it and reopen a walk the canvasser had just closed.
  it('spends the deep link, so leaving the walk cannot restart it', async () => {
    await startWalk()

    leaveWalk()
    expect(walkSheet()).toBeNull()

    await act(async () => {
      await testQueryClient.invalidateQueries({ queryKey: TURFS_QUERY_KEY })
    })

    expect(walkSheet()).toBeNull()
  })

  // A stale bookmark, a deleted list, or another org's id. None of them is a
  // walk, and the id is not spent either — it is only consumed once a turf is
  // found, so a list that arrives late still opens its walk.
  //
  // What it must NOT do is hold the screen. Deferring to a dead link was safe
  // while the saved-lists rail sat behind this one; with the rail gone it left
  // a bare map with no surface on it and no control to make one, so an
  // unhonourable request falls through to the ordinary arrival.
  it('falls back to the create flow for a ?walkTurfId= that names nothing', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [turf] })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 7 }],
    })
    render(page({ walkTurfId: 4_242 }))
    await mapReady()

    expect(await screen.findByText(/Introduce myself/)).toBeInTheDocument()
    expect(walkSheet()).toBeNull()
    expect(router.replace).not.toHaveBeenCalled()
  })
})

// The map is the surface a canvasser is looking at with a house in front of
// them, so a pin has to be a way into that door's log — and something on screen
// has to say so.
describe('NativeDoorKnockingPage walk map', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  it('expands the row behind a tapped pin without opening PersonSheet', async () => {
    const pin = await startWalk()

    fireEvent.click(pin)

    // The row for the tapped pin expands in place so the candidate can pick
    // the resident — PersonSheet doesn't cover the drawer's drag handle and
    // header. The resident's row is a reachable button inside the sheet.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Dorian Fen/ }),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText('Did they answer?')).toBeNull()
  })

  // The list has marked the stop the walk is on since #1392; the map drew
  // nothing for it, because a mark on the canvas needs a prop on a canvas both
  // surfaces share. Both halves now read one `selectedStopId`, so a row tap
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

    leaveWalk()

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

  // Outside a walk there are no pins, and a hint about them would be about
  // nothing on screen.
  it('says nothing about pins when no walk is open', async () => {
    renderPage()
    await mapReady()

    expect(screen.queryByText('Tap a pin to log the door.')).toBeNull()
  })
})

// One watch, two readers. The map draws the dot and outlives every surface; the
// switch is the third button of the map's own control cluster, where the design
// puts it. So the state is the orchestrator's and both halves read it.
describe('NativeDoorKnockingPage live location', () => {
  beforeEach(() => {
    testQueryClient.clear()
    // jsdom has no geolocation, and the watch reports its absence rather than
    // throwing — so the status the map reads is stubbed at the source.
    Object.defineProperty(navigator, 'geolocation', {
      value: { watchPosition: vi.fn(), clearWatch: vi.fn() },
      configurable: true,
    })
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      configurable: true,
    })
  })

  it('reaches the map from the map’s own control', async () => {
    await startWalk()

    const map = screen.getByTestId('voter-map')
    expect(map).toHaveAttribute('data-location-status', 'off')

    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }))

    // `locating` is the watch running with no fix yet — the stub never calls
    // back, which is also what an unanswered permission prompt looks like.
    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-location-status',
        'locating',
      ),
    )
  })

  // Leaving is the only way out of a walk, and the walk is the surface being on
  // the street is the point of — so a watch left running would keep the GPS
  // radio warm for a canvasser who has gone home.
  it('stops watching on the way out of the walk', async () => {
    await startWalk()
    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }))
    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-location-status',
        'locating',
      ),
    )

    leaveWalk()

    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-location-status',
        'off',
      ),
    )
  })

  // The refusal is structural rather than a habit: the page hands down no
  // handler on the steps that cover the map, so there is no button to press and
  // nobody gets an unsolicited permission prompt. The drawing surface is the
  // one exception, and it is asserted with the cluster it belongs to above.
  it('offers no location control on the steps that cover the map', async () => {
    renderPage()
    await screen.findByText(/Introduce myself/)

    expect(
      screen.queryByRole('button', { name: 'Show my location' }),
    ).toBeNull()
  })
})

// `endWalk` is the orchestrator's, which is why the list's own Done control
// could be wired on the card in #1395 and this could not. What it must NOT be
// is unconditional: leaving is the only way out of a walk, so stamping every
// exit would tell a canvasser who stopped after three doors that their list was
// finished. And each way in has a different "back", which is the whole reason
// the origin is tracked at all.
describe('NativeDoorKnockingPage end of walk', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  const trackComplete = () => {
    const completed: string[] = []
    api.mock('POST /v1/door-knocking/turfs/:id/complete', ({ params }) => {
      completed.push(params.id)
      return { status: 200, data: { ...turf, completed: true } }
    })
    return completed
  }

  it('marks the list done when the walk left nothing to knock', async () => {
    const completed = trackComplete()
    await startWalk([
      walkStop(11, 1, '105 Elm St', 'Dorian Fen', 'not_home'),
      walkStop(12, 2, '210 Cedar Row', 'Marisol Vega', 'supporter'),
    ])

    leaveWalk()

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

    leaveWalk()

    // Waited out rather than read straight back, so a POST that was fired and
    // is merely still in flight fails this rather than passing it.
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(OUTREACH_HUB))
    expect(completed).toEqual([])
  })

  // A serve that never landed reports no stops, which is indistinguishable from
  // a list with nobody in it — and Done has no undo beside it, so it is never
  // stamped off a fetch that failed.
  it('does not mark a list done off a route that failed to load', async () => {
    const completed = trackComplete()
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [turf] })
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 500,
      data: { message: 'boom' },
    })
    render(page({ walkTurfId: 1 }))
    await screen.findByText('Elm St & 5th')

    leaveWalk()

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(OUTREACH_HUB))
    expect(completed).toEqual([])
  })

  // The design's own exit, and the default. Staying would land the canvasser on
  // a bare map with no surface on it and no control to make one, which is what
  // the rail used to be for; the campaign they just walked is a row on the hub.
  it('lands on the outreach hub when nothing else sent us here', async () => {
    await startWalk()

    leaveWalk()

    expect(router.push).toHaveBeenCalledWith(OUTREACH_HUB)
  })

  // A walk resumed from the outreach hub's history table goes back to the row
  // that was being read, through the hub's own consume-once deep link — the one
  // the activity feed's "View outreach" already uses. Landing on a bare hub
  // instead loses the row inside a table.
  it('reopens the outreach row a resumed walk came from', async () => {
    await startWalk(undefined, { fromOutreachId: 42 })

    leaveWalk()

    expect(router.push).toHaveBeenCalledWith(`${OUTREACH_HUB}?outreachId=42`)
  })

  // One route serves both surfaces, so the exit has to pick. A Serve org
  // reaches this map from the Serve hub's door-knocking card and from its
  // history rows, and `/dashboard/outreach` is not a page it may land on:
  // that route redirects an org with no Campaign to the marketing site, so
  // exiting onto it drops the official out of the product entirely.
  it('lands a serve walk on the serve hub, not the win one', async () => {
    organization.current = { electedOfficeId: 9 }
    // The serve rail is its own endpoint, so the turf has to exist on it for
    // `?walkTurfId=` to resolve to anything.
    api.mock('GET /v1/door-knocking/serve/turfs', {
      status: 200,
      data: [turf],
    })

    await startWalk()

    leaveWalk()

    expect(router.push).toHaveBeenCalledWith(SERVE_HUB)
    expect(router.push).not.toHaveBeenCalledWith(OUTREACH_HUB)
  })

  // The whole district, re-downloaded to move a handful of status bytes, on the
  // one gesture whose very next frame is a navigation off the map. The doors are
  // folded into the cached pack instead — see `applyLoggedKnocks` — and the
  // stops here sit on dot 0's own coordinate, which is the only handle the two
  // sides share (the pack ships no person id).
  it('shows the doors just logged without downloading the district again', async () => {
    walkSession.doorsLogged = 1
    await startWalk([
      {
        ...walkStop(11, 1, '105 Elm St', 'Dorian Fen', 'not_home'),
        lat: 41.9,
        lng: -87.65,
      },
    ])
    const fetchesBefore = packSource.fetches
    // Dot 0 holds an unanswered person, so the pack rolls it up to `unknown`.
    expect(screen.getByTestId('voter-map')).toHaveAttribute(
      'data-statuses',
      '0,0',
    )

    leaveWalk()

    // `not_home` is index 1 in DOOR_KNOCK_STATUSES, which is the encoding the
    // pack's own canvassStatus plane uses.
    await waitFor(() =>
      expect(screen.getByTestId('voter-map')).toHaveAttribute(
        'data-statuses',
        '1,0',
      ),
    )
    expect(packSource.fetches).toBe(fetchesBefore)
  })

  // A walk that logged nothing has nothing to fold in, and must not invent a
  // reason to touch the pack either.
  it('leaves the map alone after a walk that logged no doors', async () => {
    await startWalk([
      {
        ...walkStop(11, 1, '105 Elm St', 'Dorian Fen', 'not_home'),
        lat: 41.9,
        lng: -87.65,
      },
    ])
    const fetchesBefore = packSource.fetches

    leaveWalk()

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(OUTREACH_HUB))
    expect(screen.getByTestId('voter-map')).toHaveAttribute(
      'data-statuses',
      '0,0',
    )
    expect(packSource.fetches).toBe(fetchesBefore)
  })

  // Same for a walk resumed from a Serve history row. The id is dropped
  // rather than carried: the Serve hub's page takes no searchParams, so
  // there is nothing there to consume it.
  it('lands a resumed serve walk on the serve hub without the deep link', async () => {
    organization.current = { electedOfficeId: 9 }
    api.mock('GET /v1/door-knocking/serve/turfs', {
      status: 200,
      data: [turf],
    })

    await startWalk(undefined, { fromOutreachId: 42 })

    leaveWalk()

    expect(router.push).toHaveBeenCalledWith(SERVE_HUB)
    expect(router.push).not.toHaveBeenCalledWith(
      `${OUTREACH_HUB}?outreachId=42`,
    )
  })
})

import { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DoorKnockingTurf, DoorKnockStatus } from '@goodparty_org/contracts'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import type { Campaign } from 'helpers/types'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { quotaQueryOptions, TURFS_QUERY_KEY } from './turfQueries'
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
    controlsBottomPx,
    location,
    liveLocationEnabled,
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
    frameDrawToken: number
    frameDrawBottomPct: number
    controlsHidden?: boolean
    controlsBottomPx?: number
    location: { status: string }
    liveLocationEnabled?: boolean
    onToggleLiveLocation?: (next: boolean) => void
    onPolygonChange: (ring: Array<[number, number]> | null) => void
    onDrawPointCount?: (count: number) => void
    onRoutePinClick?: (pin: { stopId: number }) => void
  }) => (
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
  ),
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

// The walk's sheet, which is the only `aside` the page renders now — the
// saved-lists rail that used to sit beside it is gone, and so is the same
// rail's phone sheet. One query where there used to be two that had to say
// which of the pair they meant.
const walkSheet = () => document.querySelector('aside[data-snap]')
const walkSurface = () => within(walkSheet() as HTMLElement)

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
const drawCounts = (pattern: RegExp) =>
  screen.findByText(
    (_, element) =>
      element?.tagName === 'P' && pattern.test(element.textContent ?? ''),
  )

// The who step's CTA carries the audience it is about to continue with, so it
// is matched on the word rather than on the count — which is the fixture's
// households and not what any of these tests are about.
const continueFromWho = () =>
  screen.getByRole('button', { name: /^Continue \(/ })

// Walking the flow the page opened for us to the draw step. The create flow
// has two pre-draw steps — a goal card, then the audience — and both live
// inside the page's single `filters` step, so the transition these tests are
// actually about (filters → draw, the one that starts a drawing session) is
// unchanged. Reaching it is two presses and no opener: arriving here IS asking
// to build a campaign, so there is no Create list button in front of it.
const openFlowAndDraw = async () => {
  fireEvent.click(
    await screen.findByRole('button', { name: /Introduce myself/ }),
  )
  fireEvent.click(continueFromWho())
}

// Cutting a shape and coming back to the step that frames it, which is the way
// a candidate reaches the counts and the addresses: the drawing surface is the
// map and the way forward from it and carries neither, and Back off the confirm
// step returns the draw step exactly as it was left.
const drawRingAndReview = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Draw boundaries' }))
  const tapMap = screen.getByRole('button', { name: 'tap the map' })
  fireEvent.click(tapMap)
  fireEvent.click(tapMap)
  fireEvent.click(tapMap)
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
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

// The walk's one way out, which is the X in its own sheet header. PersonSheet's
// is labelled "Close person details", so this can only be the walk's.
const leaveWalk = () =>
  fireEvent.click(walkSurface().getByRole('button', { name: 'Close' }))

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
  api.mock('GET /v1/door-knocking/quota', {
    status: 200,
    data: {
      campaignsRemaining: 5,
      campaignLimit: 5,
    },
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

  // The map is handed every row `GET /turfs` returns, archived ones included:
  // quieting a shelved list is the canvas's own business, off `archivedAt`, and
  // an outline that vanished from the district the moment it was archived would
  // read as a delete.
  it('hands the map every saved list, archived ones included', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf,
        {
          ...turf,
          id: 2,
          voterFileFilterId: 8,
          name: 'Riverside loop',
          completed: true,
          archivedAt: new Date('2026-08-22T00:00:00Z'),
        },
      ],
    })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 7 }, { id: 8 }],
    })
    render(page())

    const map = await mapReady()
    await waitFor(() => expect(map).toHaveAttribute('data-turfs', '2'))
    expect(map).toHaveAttribute('data-archived-turfs', '2')
  })

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

  // Titled, and with the duration in it. The bare `LoadingAnimation` says
  // "Loading... Something awesome." over a wait whose p95 is 34 seconds, which
  // is the half of this complaint that was about nothing being communicated.
  it('names the wait, and how long it can be, while the voter pack decodes', async () => {
    let release: () => void = () => undefined
    packSource.held = new Promise<void>((resolve) => {
      release = resolve
    })
    renderPage()

    expect(
      (await screen.findAllByText('Loading your voter map…')).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('Loading...')).toBeNull()
    expect(screen.queryByTestId('voter-map')).toBeNull()

    await act(async () => {
      release()
    })

    expect(await mapReady()).toBeInTheDocument()
  })

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

  // The WORDS follow `serveMode`, not the `eo-` slug `isServeOrg` reads for
  // party. The two diverge for an elected official still holding a live
  // campaign, and this is that org: it is drawing its Win rail, so it is
  // looking at a Win map. Both the sheet and the region under it say so, which
  // is the drift the shared accessors exist to prevent — they cover each other
  // for the whole of this wait.
  it('names the map for the rail on screen, not for the slug', async () => {
    organization.current = { slug: 'eo-city-council', electedOfficeId: 9 }
    const release = holdPack()
    // The live campaign is what makes this the divergent case: `serveMode`
    // lets a Campaign win, so this org is Win by rail and Serve by slug.
    renderPage({ campaign: { id: 3 } as Campaign })

    expect(
      (await screen.findAllByText('Loading your voter map…')).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('Loading your constituent map…')).toBeNull()

    await release()
  })

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

    // And the count arrives in it once there is one: the fixture's district is
    // three households.
    expect(
      await screen.findByRole('button', { name: 'Continue (3)' }),
    ).toBeInTheDocument()
  })

  // Inside the sheet, because the sheet is what covers the map region the same
  // sentence is painted into — so for the whole of the wait that matters the
  // only explanation on the page was behind the surface being looked at.
  it('says what the who step is waiting for, inside the sheet', async () => {
    const release = holdPack()
    renderPage()

    fireEvent.click(
      await screen.findByRole('button', { name: /Introduce myself/ }),
    )

    const sheet = screen.getByRole('dialog')
    expect(
      within(sheet).getByText(
        /Loading your voter map…\s*Large districts can take up to 30 seconds\./,
      ),
    ).toBeInTheDocument()

    await release()

    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).queryByText(
          /Large districts can take up to 30 seconds\./,
        ),
      ).toBeNull(),
    )
  })

  // `retry: 0` makes a failed pack final, so without this the step is a
  // permanently disabled button with the reason hidden behind it.
  it('surfaces a failed pack in the sheet rather than only behind it', async () => {
    packSource.failed = true
    renderPage()

    fireEvent.click(
      await screen.findByRole('button', { name: /Introduce myself/ }),
    )

    const sheet = screen.getByRole('dialog')
    expect(
      within(sheet).getByText(
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

  // The campaign allowance refuses the FLOW, not the press at the end of it,
  // which is why it is checked here and not on the route step: a candidate
  // told after drawing a boundary and naming a walk has lost work that no
  // reload brings back. Nobody pressed anything to get here, so the refusal
  // has to be the thing that opens instead.
  it('refuses to open the flow when the day’s campaigns are spent', async () => {
    api.mock('GET /v1/door-knocking/quota', {
      status: 200,
      data: {
        campaignsRemaining: 0,
        campaignLimit: 5,
      },
    })
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Daily limit reached' }),
    ).toBeInTheDocument()
    // The limit is quoted from the response rather than a constant this
    // component keeps, so an org raised past five reads its own number.
    expect(
      screen.getByText(/You've created 5 door knocking campaigns today/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Introduce myself/)).toBeNull()
  })

  // The race the opener's `isPending` guard exists for, held open rather than
  // left to msw's own timing: the guard is spent on the first paint, so an
  // opener that fired before the allowance answered would find the flow
  // already open when the refusal landed and return early — and the candidate
  // would walk straight past the limit.
  it('holds the flow shut until the allowance has answered', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    api.mock('GET /v1/door-knocking/quota', async () => {
      await held
      return {
        status: 200 as const,
        data: {
          campaignsRemaining: 0,
          campaignLimit: 5,
        },
      }
    })
    renderPage()
    await mapReady()

    expect(screen.queryByText(/Introduce myself/)).toBeNull()

    await act(async () => {
      release()
    })

    expect(
      await screen.findByRole('heading', { name: 'Daily limit reached' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Introduce myself/)).toBeNull()
  })

  // A quota read that has not answered, or that failed, opens the flow. The
  // asserts inside the create transaction are the authority either way, and
  // refusing on a number we do not have would lock door knocking for everyone
  // whenever this one endpoint is down — only a read still in flight defers.
  it('opens the flow anyway when the allowance cannot be read', async () => {
    api.mock('GET /v1/door-knocking/quota', { status: 500, data: {} })
    renderPage()

    expect(await screen.findByText(/Introduce myself/)).toBeInTheDocument()
    expect(screen.queryByText('Daily limit reached')).toBeNull()
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

  // A stale bookmark, a list deleted in the CRM since, or another org's id:
  // the param is not trusted, so all of them are a missed preselection and
  // nothing else.
  it('opens the ordinary create flow when the carried list is not one of yours', async () => {
    renderPage({ preselectedListId: 12_345 }, [
      { id: 7, name: 'Precinct 2 homeowners' },
    ])

    fireEvent.click(
      await screen.findByRole('button', { name: /Introduce myself/ }),
    )

    expect(await audiencePicker()).toHaveTextContent('All contacts')
    expect(await audiencePicker()).not.toHaveTextContent(
      'Precinct 2 homeowners',
    )
  })

  // The bug the once-guard is never unset for, walked end to end. The create
  // transaction invalidates the allowance, and the allowance answering again
  // re-runs the landing effect — so re-arming the guard when a list was
  // created reopened the flow at step one on top of the walk that had just
  // started, against a turf list that had not refetched yet.
  it('does not reopen the flow when creating a list refetches the allowance', async () => {
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
        voterFileFilterId: 9,
        name: 'Introduction walk',
      },
    })
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayloadOf([walkStop(11, 1, '105 Elm St', 'Dorian Fen')]),
    })
    render(page())
    await mapReady()

    await openFlowAndDraw()
    fireEvent.click(screen.getByRole('button', { name: 'Draw boundaries' }))
    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(tapMap)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    // The design hands straight over to the walk: the list was created to be
    // knocked, and its route is already bought and frozen.
    await screen.findByRole('button', { name: 'tap pin 11' })
    expect(walkSurface().getByText('Introduction walk')).toBeInTheDocument()

    // The allowance answering a second time, which is what the create
    // transaction's own invalidation does and what used to re-fire the opener.
    await act(async () => {
      await testQueryClient.invalidateQueries({
        queryKey: quotaQueryOptions.queryKey,
      })
    })

    expect(walkSurface().getByText('Introduction walk')).toBeInTheDocument()
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
        // A whole day's allowance left, so the draw step's quota gate never
        // fires in the tests that only care about when the scan runs.
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
    fireEvent.click(screen.getByRole('button', { name: 'Draw boundaries' }))

    const tapMap = screen.getByRole('button', { name: 'tap the map' })
    const advance = () => screen.getByRole('button', { name: 'Continue' })
    // What the button is waiting for is said by the surface rather than by the
    // button, which keeps the design's one bare word in every state.
    expect(
      screen.getByText('Tap the map to add boundary points'),
    ).toBeInTheDocument()
    expect(advance()).toBeDisabled()

    fireEvent.click(tapMap)
    // The hint is spent on the first point and the count pill reads the shape
    // from there — at nothing, because one point is not a ring.
    expect(screen.queryByText('Tap the map to add boundary points')).toBeNull()
    expect(screen.getByText('0 selected')).toBeInTheDocument()
    expect(advance()).toBeDisabled()

    fireEvent.click(tapMap)
    expect(advance()).toBeDisabled()

    // The canvas closes the shape itself on the third tap rather than waiting
    // for a finish gesture, so this is the moment the pill and the button both
    // have something to say.
    fireEvent.click(tapMap)
    await waitFor(() => expect(advance()).toBeEnabled())
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    fireEvent.click(advance())

    expect(screen.getByLabelText('Campaign name')).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Draw boundaries' }))

    // Uncovering the map asks for the shape back in view: the camera has not
    // moved, but a candidate who has been reading a step has no idea where
    // their boundary is. Fitted into the whole of it, because nothing covers
    // the drawing surface.
    expect(map).toHaveAttribute('data-frame', '1')
    expect(map).toHaveAttribute('data-frame-bottom', '0')
    expect(map).toHaveAttribute('data-controls-hidden', 'false')

    // And back, with nothing drawn yet to ask about.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(map).toHaveAttribute('data-controls-hidden', 'true')
    expect(
      screen.getByRole('button', { name: 'Draw boundaries' }),
    ).toBeVisible()
  })

  // The drawing surface's own footer is 88px of opaque bar across the bottom,
  // so the cluster clears it by the design's 96 rather than sitting at the
  // 16px edge underneath it — which left the zoom buttons half-covered and the
  // locate toggle entirely hidden. The locate button is offered here and only
  // here inside the flow: a boundary is cut standing on the street it covers
  // as often as at a desk, and knowing where you are is how you know which
  // blocks to enclose.
  it('clears the drawing surface’s footer, with the full cluster on it', async () => {
    renderPage()
    await mapReady()

    await openFlowAndDraw()

    const map = screen.getByTestId('voter-map')
    expect(map).toHaveAttribute('data-controls-hidden', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Draw boundaries' }))

    expect(map).toHaveAttribute('data-controls-hidden', 'false')
    expect(map).toHaveAttribute('data-controls-bottom', '96')
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

    await drawCounts(/3 matching households · 3 selected households/)
  })

  // What the walkthrough asked for: the actual houses, at the one moment the
  // shape can still be changed. The pack has no addresses in it, so these come
  // from gp-api's evaluation — and a block of flats reads as the several doors
  // it is under the single coordinate the router will visit.
  it('lists the addresses inside the drawn ring, on request', async () => {
    mockPreview()
    renderPage()
    await mapReady()

    await openFlowAndDraw()
    await drawRingAndReview()

    await drawCounts(/3 matching households · 3 selected households/)
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
  // fixture's ring holds 3 households by the pack and 2 doors by the server on
  // purpose: the counts here are deliberately different so the swap is visible.
  it('reports the server count once it has one', async () => {
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
    await mapReady()

    await openFlowAndDraw()
    await drawRingAndReview()
    await drawCounts(/3 matching households · 3 selected households/)

    fireEvent.click(screen.getByRole('button', { name: 'See the addresses' }))

    // The pack's 3 is gone from the count line, not printed next to the
    // server's 2. The district total beside it is unchanged, because no
    // polygon was ever what it was measuring.
    const counts = await drawCounts(
      /3 matching households · 2 selected households/,
    )
    expect(counts.textContent).not.toMatch(/3 selected/)
  })

  // Backing out to the filters re-cuts the audience, and the step forward from
  // it wipes the shape — so an address panel left open would spring back over
  // a list nobody has asked about yet, and spend a scan of people-db to do it.
  // The request count is asserted and not assumed: "it only runs when it is
  // asked for" is the whole reason the page owns the flag.
  it('asks about the addresses again after the filters are re-cut', async () => {
    mockPreview()
    renderPage()
    await mapReady()

    await openFlowAndDraw()
    await drawRingAndReview()
    expect(previewCalls.count).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'See the addresses' }))
    await screen.findByText('1200 W Elm St Apt 1')

    // Back lands on the audience step, whose CTA carries the district count.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    const callsOnLeaving = previewCalls.count
    fireEvent.click(continueFromWho())

    expect(document.getElementById('draw-step-doors')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'See the addresses' }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(previewCalls.count).toBe(callsOnLeaving)
  })
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

  it('opens the door behind a tapped pin', async () => {
    const pin = await startWalk()

    fireEvent.click(pin)

    await waitFor(() =>
      expect(screen.getByText('Did they answer?')).toBeInTheDocument(),
    )
    // The door, which is what the sheet is headed with and what a pin is: the
    // stop behind pin 11, not whichever of its residents is selected first.
    expect(
      screen.getByRole('heading', { name: '105 Elm St', level: 2 }),
    ).toBeInTheDocument()
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

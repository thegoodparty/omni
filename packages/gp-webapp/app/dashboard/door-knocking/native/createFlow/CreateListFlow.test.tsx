import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps, ReactElement } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import CreateListFlow from './CreateListFlow'
import type { SavedListOption } from './savedListOptions'
import type { PolygonRing } from '../VoterMapCanvas'
import { DoorKnockingSurfaceProvider } from '../doorKnockingSurface'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// mapbox-gl-draw hands back an open ring; save must close it before POSTing.
const OPEN_RING: PolygonRing = [
  [-87.66, 41.92],
  [-87.65, 41.92],
  [-87.65, 41.93],
]

const turfStats = (stops: number, households: number) => ({
  stops,
  people: stops * 2,
  households,
  partyMix: [],
  ageMix: [],
})

const baseProps = {
  filters: {},
  onFiltersChange: vi.fn(),
  onStepChange: vi.fn(),
  onClose: vi.fn(),
  districtHouseholds: 1500,
  districtHouseholdsPending: false,
  districtHouseholdsFailed: false,
  districtUnavailable: false,
  savedLists: [],
  allContactsHouseholds: 12000,
  ring: OPEN_RING,
  turfStats: {
    stops: 14,
    people: 22,
    households: 9,
    partyMix: [],
    ageMix: [],
  },
  drawPointCount: 3,
  onUndoPoint: vi.fn(),
  drawFullScreen: false,
  onDrawFullScreenChange: vi.fn(),
  onRestartDrawing: vi.fn(),
  color: '#2563eb',
  drawnStops: null,
  onListCreated: vi.fn(),
  isServeOrg: false,
  unpreviewableKeys: [],
  orgSlug: 'campaign-9',
  addressPreview: null,
  previewPending: false,
  previewFailed: false,
  previewStale: false,
  onShowAddresses: vi.fn(),
  onHideAddresses: vi.fn(),
  onRetryAddresses: vi.fn(),
}

const preview = (
  locations: Array<{ doors: Array<{ address: string; people: number }> }>,
  totals?: {
    stops: number
    doors: number
    people: number
  },
) => ({
  locations,
  stops: totals?.stops ?? locations.length,
  doors:
    totals?.doors ??
    locations.reduce((sum, location) => sum + location.doors.length, 0),
  people:
    totals?.people ??
    locations.reduce(
      (sum, location) =>
        sum + location.doors.reduce((doors, door) => doors + door.people, 0),
      0,
    ),
})

// What gp-api hands back for a created turf. Every count is a real number
// because the route exists by the time this response is written — the create
// transaction buys it — so there is no shape of turf with nothing to report.
const savedTurf = {
  id: 5,
  voterFileFilterId: 21,
  name: 'Tuesday evening',
  color: '#2563eb',
  geoPoly: {
    type: 'Polygon' as const,
    coordinates: [[...OPEN_RING, OPEN_RING[0] as [number, number]]],
  },
  doorCount: 9,
  peopleCount: 22,
  loggedCount: 0,
  knockedDoorCount: 0,
  routeSeconds: 1860,
  completed: false,
  archivedAt: null,
  createdAt: new Date('2026-08-20T00:00:00Z'),
  updatedAt: new Date('2026-08-20T00:00:00Z'),
}

// Reaching the last step means having been on the one before it, because the
// campaign name the route step's title says is typed there. Two moves, exactly
// as a candidate makes them, and the rerender is the page's own `step` prop
// catching up with the advance the flow asked for.
const advanceToRoute = (
  rerender: (ui: ReactElement) => void,
  props: Partial<ComponentProps<typeof CreateListFlow>> = {},
  campaignName = 'Tuesday evening',
) => {
  fireEvent.change(screen.getByLabelText('Campaign name'), {
    target: { value: campaignName },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  rerender(<CreateListFlow {...baseProps} {...props} step="route" />)
}

// The flow opens on the goal cards, and both pre-draw stages live inside the
// orchestrator's single `filters` step — so a test about the audience walks
// through a goal card to reach it, exactly as a candidate does.
const renderAtWho = (
  props: Partial<ComponentProps<typeof CreateListFlow>> = {},
) => {
  const view = render(
    <CreateListFlow {...baseProps} step="filters" {...props} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Introduce myself/ }))
  return view
}

// The control the who step opens on: one row naming the audience and its door
// count, labelled by the eyebrow above it.
const audiencePicker = () => screen.getByRole('combobox', { name: 'All lists' })

// Choosing a list is open-then-pick. The rows only exist in the document while
// the panel is open, which is what leaves the step room for anything else.
const openPicker = () => fireEvent.click(audiencePicker())

const pickList = async (name: RegExp | string) => {
  openPicker()
  fireEvent.click(await screen.findByRole('option', { name }))
}

// The filter pills are the step's second face, behind the picker's "Create a
// new list" row: cutting an audience by hand is the alternative to picking one
// somebody already cut, not a way out of the flow.
const buildNewList = () => {
  openPicker()
  fireEvent.click(screen.getByRole('button', { name: /Create a new list/ }))
}

// Drawing happens on the uncovered map, not on the step that frames it: the
// step behind carries the counts and the warnings, and this surface carries
// the shape and the way forward from it.
const drawingSurface = (
  props: Partial<ComponentProps<typeof CreateListFlow>> = {},
) => <CreateListFlow {...baseProps} step="draw" drawFullScreen {...props} />

// The step heading is said twice on purpose — once sr-only as the sheet's
// accessible title, once in the body as the intro block — so a test that
// means the visible one has to say so.
const heading = (name: string) =>
  screen.getByRole('heading', { level: 3, name })

describe('CreateListFlow', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.clearAllMocks()
  })

  // The one write in the whole flow, and it happens at the very end. Every
  // step before Build route is client state: the filter POST that precedes it
  // is the reusable audience, and the turf POST is turf, route, stops and the
  // outreach envelope in one transaction on the far side.
  it('creates the voter list from the filter draft, then buys the route', async () => {
    const calls: Array<{ kind: string; body: unknown }> = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      calls.push({ kind: 'filter', body })
      return { status: 200, data: { id: 77 } }
    })
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      calls.push({ kind: 'turf', body })
      return {
        status: 200,
        data: { ...savedTurf, id: 5, voterFileFilterId: 77 },
      }
    })
    const onListCreated = vi.fn()
    const props = {
      filters: { partyDemocrat: true },
      onListCreated,
    }

    const { rerender } = render(
      <CreateListFlow {...baseProps} {...props} step="confirm" />,
    )

    // Nothing has been written by the time the confirm step is done with —
    // Save is a move, not a save, which is what the single atomic commit at
    // the end of the flow costs this step's label in honesty.
    advanceToRoute(rerender, props, 'Lakeview blitz')
    expect(calls).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    await waitFor(() =>
      expect(onListCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: 5 }),
      ),
    )
    expect(calls.map((call) => call.kind)).toEqual(['filter', 'turf'])
    expect(calls[0]?.body).toMatchObject({
      name: 'Lakeview blitz',
      partyDemocrat: true,
      partyRepublican: false,
    })
    expect(calls[1]?.body).toMatchObject({
      voterFileFilterId: 77,
      name: 'Lakeview blitz',
      // The route options this step exists to collect, sent with the turf
      // rather than to a second endpoint: they are what the vendor is paid to
      // plan, so they cannot arrive after the purchase.
      mode: 'walk',
      loop: true,
      geoPoly: {
        type: 'Polygon',
        coordinates: [
          [
            [-87.66, 41.92],
            [-87.65, 41.92],
            [-87.65, 41.93],
            [-87.66, 41.92],
          ],
        ],
      },
    })
    // One event for one transaction. The `RouteBuilt` that used to follow it
    // described a second press that no longer exists.
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.ListCreated, {
      stops: 14,
      people: 22,
      filterCount: 1,
      mode: 'walk',
      loop: true,
      suggestedMode: null,
    })
  })

  it('reuses the created filter when the route purchase is retried', async () => {
    let filterPosts = 0
    let turfPosts = 0
    api.mock('POST /v1/voters/voter-file/filter', () => {
      filterPosts += 1
      return { status: 200, data: { id: 88 } }
    })
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      turfPosts += 1
      if (turfPosts === 1) return { status: 500, data: {} }
      expect(body).toMatchObject({ voterFileFilterId: 88 })
      return {
        status: 200,
        data: { ...savedTurf, id: 6, voterFileFilterId: 88 },
      }
    })
    const onListCreated = vi.fn()

    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="confirm"
        onListCreated={onListCreated}
      />,
    )
    advanceToRoute(rerender, { onListCreated }, 'Retry turf')

    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Building the route failed/,
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))
    await waitFor(() => expect(onListCreated).toHaveBeenCalled())
    // One list total across both attempts — no orphan per retry.
    expect(filterPosts).toBe(1)
    expect(turfPosts).toBe(2)
  })

  // The rollback is a database rollback, not a loss of the candidate's work.
  // The flow is client state right up to the commit, so a failed purchase
  // leaves the polygon, the filters, the name, the colour, the mode and the
  // loop exactly where they were, and the retry above is one press away.
  it('keeps the step standing when the purchase fails', async () => {
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 3 },
    })
    api.mock('POST /v1/door-knocking/turfs', {
      status: 400,
      data: { message: 'No matching voters inside this turf — widen the area' },
    })
    const onListCreated = vi.fn()

    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="confirm"
        onListCreated={onListCreated}
      />,
    )
    advanceToRoute(rerender, { onListCreated })
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    // A 4xx is something the candidate can act on and arrives with its own
    // instruction, so it is shown rather than swallowed by "try again in a
    // moment" — that advice belongs to a 5xx, where waiting really is the fix.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No matching voters inside this turf — widen the area',
    )
    expect(onListCreated).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Build route' })).toBeEnabled()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.DoorKnocking.RouteBuildFailed,
      { mode: 'walk', loop: true, status: 400 },
    )
  })

  // The route step is the only step that spends money, and these two controls
  // are the whole of what it spends it on. The mode rides to the vendor as the
  // travel profile; the loop decides whether the tour closes.
  it('sends the travel mode and the loop the route step collected', async () => {
    let turfBody: unknown = null
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 3 },
    })
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      turfBody = body
      return { status: 200, data: savedTurf }
    })
    const onListCreated = vi.fn()

    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="confirm"
        onListCreated={onListCreated}
      />,
    )
    advanceToRoute(rerender, { onListCreated })

    fireEvent.click(screen.getByRole('radio', { name: /Driving/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /End where I start/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    await waitFor(() => expect(onListCreated).toHaveBeenCalled())
    expect(turfBody).toMatchObject({ mode: 'drive', loop: false })
  })

  // Every stop within a five-minute walk of the next is what makes a list
  // walkable, and the drawn shape is the only thing that knows. It only tags a
  // radio — the selected mode stays the candidate's, so a suggestion that
  // decodes late cannot move a choice already made.
  it('suggests driving for a spread-out shape, without overruling a pick', async () => {
    let turfBody: unknown = null
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 3 },
    })
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      turfBody = body
      return { status: 200, data: savedTurf }
    })
    const onListCreated = vi.fn()
    // Two stops a couple of kilometres apart: nobody walks that between doors.
    const props = {
      onListCreated,
      drawnStops: [
        [-87.65, 41.9],
        [-87.62, 41.93],
      ] as Array<[number, number]>,
    }

    const { rerender } = render(
      <CreateListFlow {...baseProps} {...props} step="confirm" />,
    )
    advanceToRoute(rerender, props)

    expect(screen.getByRole('radio', { name: /Driving/ })).toBeChecked()
    expect(screen.getByText(/more than a 5-minute walk/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /Walking/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    await waitFor(() => expect(onListCreated).toHaveBeenCalled())
    // Overruled, and the analytics record both halves so the suggestion's
    // accuracy is readable rather than assumed.
    expect(turfBody).toMatchObject({ mode: 'walk' })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.DoorKnocking.ListCreated,
      expect.objectContaining({ mode: 'walk', suggestedMode: 'drive' }),
    )
  })

  // An audience cut by hand used to be filed here, from a step that named it
  // and ended the flow. Door knocking has no ending that skips the boundary and
  // the route, so the who step writes nothing at all: the list is minted lazily
  // by the create transaction, under the campaign's own name. A flow abandoned
  // before Build route therefore leaves no half-made list in the CRM.
  it('writes nothing when a hand-cut audience continues to the draw step', async () => {
    let filterPosts = 0
    api.mock('POST /v1/voters/voter-file/filter', () => {
      filterPosts += 1
      return { status: 200, data: { id: 44 } }
    })
    const onStepChange = vi.fn()

    renderAtWho({ filters: { partyDemocrat: true }, onStepChange })
    fireEvent.click(screen.getByRole('button', { name: 'Continue (1,500)' }))

    // Waited out rather than read straight back, so a POST that was fired and
    // is merely still in flight fails this rather than passing it.
    await waitFor(() => expect(onStepChange).toHaveBeenCalledWith('draw'))
    expect(filterPosts).toBe(0)
  })

  it('gates the drawing surface on a drawn shape under the cap', () => {
    const { rerender } = render(
      drawingSurface({ ring: null, turfStats: null, drawPointCount: 0 }),
    )
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    rerender(drawingSurface({ turfStats: turfStats(151, 140) }))
    // The cap is on stops (the router's unit), so 151 stops holding 140 doors
    // is over it — and the pill beside the dead button is the only thing on
    // this surface counting anything.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(screen.getByText('151 selected')).toBeInTheDocument()

    rerender(drawingSurface({ turfStats: turfStats(14, 9) }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  // The limit itself is stated on the step behind the map, where the rest of
  // what the shape costs an evening is stated: the drawing surface is the map
  // and the way forward from it, so a candidate over the cap reads why there.
  it('names the stop limit on the step framing the map', () => {
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(151, 140)}
      />,
    )

    expect(screen.getByText(/Over the 150-stop limit/)).toBeInTheDocument()
  })

  // The button is the design's bare word in every state, including all three
  // of its dead ones. It used to rename itself — counting the points still
  // needed, then announcing an empty shape — which put a running commentary in
  // the one control on the surface. What it is waiting for is said around it
  // instead: the centred hint names the gesture until the first point lands,
  // and the count pill reads the shape from there.
  it('keeps the drawing surface’s button on one word through every dead state', () => {
    const unfinished = (drawPointCount: number) =>
      drawingSurface({ ring: null, turfStats: null, drawPointCount })
    const { rerender } = render(unfinished(1))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    rerender(unfinished(2))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    // Three points down but nothing inside them: still Continue, still dead.
    rerender(drawingSurface({ turfStats: turfStats(0, 0) }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    rerender(drawingSurface({ turfStats: turfStats(14, 9), drawPointCount: 3 }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  // The regression this line shipped with: two counts side by side, one
  // district-wide and one in-polygon, with nothing saying which was which. The
  // step still reports both — a candidate cutting turf needs to know how much
  // of the audience the boundary has taken — so each carries its own noun.
  it('names the district total and the in-polygon count apart on the draw step', () => {
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        districtHouseholds={12000}
        turfStats={turfStats(84, 61)}
      />,
    )

    // The counts sit in their own spans, so this matches the paragraph's whole
    // text rather than a single node.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          /12,000 matching households · 61 selected households/.test(
            element.textContent ?? '',
          ),
      ),
    ).toBeInTheDocument()
  })

  // The count in this button was the canvas's shape too ("Add to saved lists
  // (N)"), and the product owner asked for it out on 2026-08-26. It can go
  // because it was never the only place the number was said: the pill sits
  // right above it and counts the same shape, in the unit the cap is stated in.
  it('leaves the count to the pill rather than the drawing surface’s Continue', () => {
    render(drawingSurface({ turfStats: turfStats(14, 9) }))

    const advance = screen.getByRole('button', { name: 'Continue' })
    expect(advance).toBeEnabled()
    expect(advance.textContent).not.toMatch(/\d/)
    expect(screen.getByText('14 selected')).toBeInTheDocument()
  })

  // The design draws nothing under its preview, so neither do we: the knocking
  // estimate this step used to print is a metric in the details drawer, where
  // it can be stated against a real route rather than against a guess.
  it('keeps the draw step to the counts the design states', () => {
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={{
          stops: 90,
          people: 150,
          households: 70,
          partyMix: [
            { label: 'Democratic', people: 50 },
            { label: 'Republican', people: 30 },
          ],
          ageMix: [],
        }}
      />,
    )

    expect(
      screen.getByText('matching households', { exact: false }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/of knocking/)).toBeNull()
    expect(screen.queryByText(/50 Democratic/)).toBeNull()
  })

  // Soft warning informs; only the 150 cap blocks.
  it('warns past 100 stops without blocking the save', () => {
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(100, 80)}
      />,
    )
    expect(screen.queryByText(/long evening/)).toBeNull()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(101, 80)}
      />,
    )
    expect(
      screen.getByText(/Over 100 stops is a long evening/),
    ).toBeInTheDocument()

    // Past the hard cap only the blocking message stands.
    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(151, 120)}
      />,
    )
    expect(screen.queryByText(/long evening/)).toBeNull()
    expect(screen.getByText(/Over the 150-stop limit/)).toBeInTheDocument()

    // Informing is all it does: the shape is still finishable at 101 stops,
    // which is the whole difference between this warning and the cap.
    rerender(drawingSurface({ turfStats: turfStats(101, 80) }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  // The who step's Continue carries the audience it is about to continue with.
  // It is the one number on the step that moves as a pill is toggled — the
  // picker's own door count is the unfiltered universe and stands still — so
  // reading the CTA as the picker's count would be reading the district as the
  // list.
  it('counts the filtered audience in the who step’s Continue, not the whole universe', () => {
    renderAtWho({ districtHouseholds: 1500, allContactsHouseholds: 12000 })

    expect(
      screen.getByRole('button', { name: 'Continue (1,500)' }),
    ).toBeEnabled()
    expect(audiencePicker()).toHaveTextContent('All contacts')
    expect(audiencePicker()).toHaveTextContent('12,000 doors')
  })

  it('refuses to continue from an audience holding nobody', () => {
    renderAtWho({ districtHouseholds: 0 })

    expect(screen.getByRole('button', { name: 'Continue (0)' })).toBeDisabled()
  })

  // The same disabled button, and a completely different fact. A count that has
  // not arrived is 0 here too, and printing it makes "we are still counting"
  // indistinguishable from "this district is empty" — for a wait whose p95 is
  // 34 seconds. Phone banking's identical CTA on this same shell already drops
  // to the bare word while it counts.
  it('drops the count from the who step’s Continue while it is still pending', () => {
    renderAtWho({ districtHouseholds: 0, districtHouseholdsPending: true })

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Continue \(/ })).toBeNull()
    expect(
      screen.getByText(
        /Loading your voter map…\s*Large districts can take up to 30 seconds\./,
      ),
    ).toBeInTheDocument()
  })

  // And a count that is never arriving. The pack does not retry, so the step is
  // otherwise a permanently disabled button with nothing on screen saying why —
  // the map region that carries this sentence is underneath this sheet.
  it('says why the who step is stuck when the pack failed', () => {
    renderAtWho({ districtHouseholds: 0, districtHouseholdsFailed: true })

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Continue \(/ })).toBeNull()
    expect(
      screen.getByText('The voter map could not load. Refresh to try again.'),
    ).toBeInTheDocument()
  })

  // The third way the count can be absent, and the one the other two get
  // wrong: no pack was ever requested, so it is neither arriving nor failed.
  // Told it was pending, this step promises a download that will never happen;
  // told it failed, it asks for a refresh that cannot help.
  it('says the office has no voter data rather than promising a download', () => {
    renderAtWho({ districtHouseholds: 0, districtUnavailable: true })

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(
      screen.getByText(/Voter data is not available for this office yet/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Loading your voter map/)).toBeNull()
    expect(screen.queryByText(/could not load/)).toBeNull()
  })

  // CHANGED DELIBERATELY: the flow no longer opens on the filters. `filters`
  // is the orchestrator's name for the whole pre-draw phase, and reaching the
  // draw step from an unfiltered draft is now two moves — pick a goal, then
  // continue past the audience.
  it('advances from the goal cards through the audience to the draw step', () => {
    const onStepChange = vi.fn()
    renderAtWho({ onStepChange })

    // Choosing a goal is a stage inside `filters`, so the orchestrator hears
    // nothing about it — it only needs to know when a shape is being cut.
    expect(onStepChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continue (1,500)' }))
    expect(onStepChange).toHaveBeenCalledWith('draw')
  })

  // Labels are sourced from the config, not hardcoded: 'Contacts Made' was
  // renamed to 'Prior Contacts Made' days after this test landed, which would
  // have made a literal assertion pass while the group still rendered.
  const fieldLabel = (key: string) =>
    filterSections
      .flatMap((section) => section.fields)
      .find((field) => field.key === key)?.label

  it('offers the contacts-made group to a campaign', () => {
    const contactsMadeLabel = fieldLabel('contacts_made')
    const partyLabel = fieldLabel('political_party')
    expect(contactsMadeLabel).toBeTruthy()
    expect(partyLabel).toBeTruthy()

    renderAtWho()
    buildNewList()

    expect(screen.getByLabelText(contactsMadeLabel as string)).toBeTruthy()
    expect(screen.getByLabelText(partyLabel as string)).toBeTruthy()
  })

  // Every group visible by scrolling, which is the decision that keeps door
  // knocking off the SMS picker: no popover, no filter-builder sub-step, and
  // no "Add condition" button in front of pills that are already on screen.
  // The one press in front of them chooses between two audiences rather than
  // revealing a group — it is how a candidate says "none of my lists".
  it('shows every filter group at once, with nothing to press to reveal them', () => {
    renderAtWho()
    buildNewList()

    for (const field of filterSections.flatMap((section) => section.fields)) {
      expect(screen.getByLabelText(field.label)).toBeTruthy()
    }
    expect(screen.queryByRole('button', { name: /Add condition/i })).toBeNull()
  })

  // The filters are a face of the who step, not a screen of its own: leaving
  // them puts the picker back with the flow still on step two, so a candidate
  // who opened them by mistake is one press from the lists rather than one
  // press from the start of the flow.
  it('returns from the filter pills to the list picker without leaving the step', () => {
    renderAtWho()
    buildNewList()
    expect(
      screen.getByLabelText(fieldLabel('political_party') as string),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back to lists' }))

    expect(audiencePicker()).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
  })

  // The canvas puts Top issue first in the shared filter pool. We hold no
  // per-voter issue attribute anywhere — no Voter column, no key in
  // voterFilterBaseSchema, and filterDimensions.catalog.ts names it a blocked
  // dimension — so the group is omitted rather than faked. Asserted here
  // because the day someone adds it to the shared config is the day it appears
  // in this flow by accident.
  it('offers no top-issue filter', () => {
    renderAtWho()
    buildNewList()

    expect(screen.queryByLabelText(/top issue/i)).toBeNull()
  })

  // The pack has no 65+ bucket, so that pill leaves the shaded preview
  // unnarrowed while the saved list still applies it — a candidate drawing
  // against the wider shape has no way to know unless we say so.
  it('discloses filters the map preview cannot narrow by', () => {
    const { rerender } = render(
      <CreateListFlow {...baseProps} step="draw" unpreviewableKeys={[]} />,
    )
    expect(screen.queryByText(/can’t yet shade by/)).toBeNull()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        unpreviewableKeys={['age65Plus']}
      />,
    )
    const label = filterSections
      .flatMap((section) => section.fields)
      .flatMap((field) => field.options)
      .find((option) => option.key === 'age65Plus')?.label
    expect(label).toBeTruthy()
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          new RegExp(`can’t yet shade by ${label}`).test(
            element.textContent ?? '',
          ),
      ),
    ).toBeInTheDocument()
  })

  // The bare option labels ('0'…'5+') made this read "the map can't shade by
  // 0 yet", which sounds like a bug rather than a filter.
  it('names the prior-contacts group rather than its bucket number', () => {
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        unpreviewableKeys={['contactsMade0', 'contactsMade3']}
      />,
    )

    const disclosure = screen.getByText(
      (_, element) =>
        element?.tagName === 'P' &&
        /can’t yet shade by/.test(element.textContent ?? ''),
    )
    // Named once, however many of its buckets are selected.
    expect(disclosure.textContent).toContain(
      'can’t yet shade by Prior contacts made,',
    )
  })

  // Two unshadeable filters used to be comma-joined into a sentence written
  // for one — "shade by 65+, Prior contacts made yet, so these counts include
  // people that filter will exclude" — which reads as a typo rather than as a
  // list. The wiring, not the joining, is what this asserts; the joins
  // themselves are covered in voterFilterPreview.test.ts.
  it('joins two unshadeable filters with or, and pluralises around them', () => {
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        unpreviewableKeys={['age65Plus', 'contactsMade0']}
      />,
    )

    const disclosure = screen.getByText(
      (_, element) =>
        element?.tagName === 'P' &&
        /can’t yet shade by/.test(element.textContent ?? ''),
    )
    // "Your list", not "Your saved list": this renders the draw step of a
    // from-scratch list, so there is no saved list to name.
    expect(disclosure.textContent).toBe(
      'The map can’t yet shade by 65+ or Prior contacts made, so these counts ' +
        'include people those filters will exclude. Your list still ' +
        'applies them when you knock.',
    )
  })

  // The mis-tap fix: a stray vertex was previously only draggable somewhere
  // harmless, and a turf's polygon freezes permanently once it is knocked.
  it('offers Undo only once a point exists', () => {
    const onUndoPoint = vi.fn()
    const { rerender } = render(
      drawingSurface({
        ring: null,
        turfStats: null,
        drawPointCount: 0,
        onUndoPoint,
      }),
    )
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()

    rerender(
      drawingSurface({
        ring: null,
        turfStats: null,
        drawPointCount: 1,
        onUndoPoint,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndoPoint).toHaveBeenCalledTimes(1)
  })

  // Leaving the map is how a half-drawn shape gets thrown away, and there is
  // no way back to it. Its own question, not the shell's "Discard changes?":
  // that one is about abandoning the whole flow, and answering it here would
  // offer to lose the audience along with the boundary.
  it('asks before leaving the drawing surface with a shape on it', () => {
    const onDrawFullScreenChange = vi.fn()
    const { rerender } = render(
      drawingSurface({
        ring: null,
        turfStats: null,
        drawPointCount: 0,
        onDrawFullScreenChange,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onDrawFullScreenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByText('Discard this turf?')).toBeNull()

    rerender(drawingSurface({ drawPointCount: 2, onDrawFullScreenChange }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onDrawFullScreenChange).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Discard this turf?')).toBeInTheDocument()
    expect(
      screen.getByText('The boundaries you drew will not be saved.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onDrawFullScreenChange).toHaveBeenCalledTimes(2)
    expect(onDrawFullScreenChange).toHaveBeenLastCalledWith(false)
  })

  // The dialog above says the boundary will not be saved, and it has to be
  // true by the time the next screen is read. Closing the overlay alone left
  // the ring on the canvas, still feeding the step's selected-household count —
  // a sentence the very next screen contradicted. It restarts the session
  // rather than clearing it, because the canvas keeps drawing live behind the
  // draw step's shield and a cleared map is one the next Draw boundaries lands
  // on with nothing able to place a point.
  it('throws the boundary away when the discard is confirmed', () => {
    const onRestartDrawing = vi.fn()
    render(drawingSurface({ drawPointCount: 2, onRestartDrawing }))

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep drawing' }))
    expect(onRestartDrawing).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onRestartDrawing).toHaveBeenCalledTimes(1)
  })

  // The draw step is the one step rendered outside `OutreachFlowShell`, so its
  // X is the one X not already wired to the shell's confirm — and it is the
  // step standing over a drawn boundary. Left bare it closed the flow and
  // dropped the shape without asking, on the screen with the most to lose.
  it('asks the shell’s own question before the draw step’s X closes the flow', () => {
    const onClose = vi.fn()
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        ring={null}
        turfStats={null}
        drawPointCount={0}
        onClose={onClose}
      />,
    )

    // Nothing drawn and nothing chosen: the X is not a question.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('confirms before the draw step’s X drops a drawn boundary', () => {
    const onClose = vi.fn()
    render(<CreateListFlow {...baseProps} step="draw" onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    // The shell's words, not the drawing surface's — this abandons the whole
    // flow, audience and all, rather than just the shape.
    expect(screen.getByText('Discard changes?')).toBeInTheDocument()
    expect(
      screen.getByText('Your draft and selections will be lost.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // The drawing chrome is a pointer-events-none overlay so taps reach the map
  // underneath. Only the controls themselves re-enable them — miss that and
  // pressing Undo also drops a boundary point where the button was.
  it('keeps the draw controls from leaking a click through to the map', () => {
    render(drawingSurface({ drawPointCount: 2 }))

    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo).toHaveClass('pointer-events-auto')
    // The cluster the controls sit in stays click-through, so the map keeps
    // the full width of the band it was given.
    expect(undo.parentElement).not.toHaveClass('pointer-events-auto')
  })

  // The gap the walkthrough reported: the draw step stated a door count and
  // never said which doors it meant, at the one moment the shape can still be
  // changed. One row per door, and a block of flats reads as the several doors
  // it is under the single coordinate the router will visit.
  it('lists the enclosed addresses, grouping the ones that share a location', () => {
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(2, 3)}
        addressPreview={preview([
          {
            doors: [
              { address: '1200 W Elm St Apt 1', people: 2 },
              { address: '1200 W Elm St Apt 2', people: 1 },
            ],
          },
          { doors: [{ address: '14 N Oak Ave', people: 4 }] },
        ])}
      />,
    )

    const panel = document.getElementById('draw-step-doors')
    expect(panel).not.toBeNull()
    expect(screen.getByText('2 doors at one location')).toBeInTheDocument()
    // Three rows for the three doors the stats bar counts, and no numerals on
    // them: nothing has decided a visiting order at draw time, so a numbered
    // row would imply one the canvasser is held to.
    expect(panel?.querySelectorAll('li li')).toHaveLength(3)
    expect(panel?.querySelector('ol')).toBeNull()
    expect(screen.getByText('1200 W Elm St Apt 1')).toBeInTheDocument()
    expect(screen.getByText('1200 W Elm St Apt 2')).toBeInTheDocument()
    expect(screen.getByText('14 N Oak Ave')).toBeInTheDocument()
    // globals.css gives every `<li>` inside a `data-slot` element `display:
    // flex`, which ran the "N doors at one location" heading into the first
    // address. jsdom has no layout, so this asserts the override is present
    // rather than its effect; the rendered proof is in the PR's screenshots.
    const location = screen
      .getByText('2 doors at one location')
      .closest('li') as HTMLElement
    expect(location.className.split(/\s+/)).toContain('block')
  })

  // The rule this feature has already broken once: one quantity gets one
  // number. The preview counts the same doors the route will be built from,
  // so it REPLACES the pack's estimate — and the hedges that estimate needed
  // go with it, because they explain a shortfall these counts don't have.
  it('reports the preview counts and retires the estimate that stood in', () => {
    const estimate = {
      stops: 14,
      people: 22,
      households: 9,
      partyMix: [],
      ageMix: [],
    }
    const answered = preview(
      [{ doors: [{ address: '14 N Oak Ave', people: 3 }] }],
      { stops: 6, doors: 7, people: 12 },
    )
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={estimate}
        unpreviewableKeys={['age65Plus']}
      />,
    )

    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText(/The map can’t yet shade by/)).toBeInTheDocument()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={estimate}
        unpreviewableKeys={['age65Plus']}
        addressPreview={answered}
      />,
    )

    // The pack's 9 doors are gone from the count line, not sitting beside the
    // preview's 7.
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.queryByText('9')).toBeNull()
    expect(screen.queryByText(/The map can’t yet shade by/)).toBeNull()
    // What the preview does still owe the reader: these are suppressed
    // already, so a shorter walk than this is not the expectation.
    expect(screen.getByText(/already out/)).toBeInTheDocument()

    // The same replacement one surface over: the pill counts the preview's
    // stops rather than the pack's 14.
    rerender(drawingSurface({ turfStats: estimate, addressPreview: answered }))
    expect(screen.getByText('6 selected')).toBeInTheDocument()
    expect(screen.queryByText('14 selected')).toBeNull()
  })

  // A ring over half a district holds more stops than a route can and more
  // rows than a phone should render, so the list stops and says it stopped —
  // silently showing 150 of 900 is the reading that misleads. The shortfall is
  // counted in stops, the unit the cap above it is stated in.
  it('says how many stops it left off the list', () => {
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        addressPreview={preview([
          {
            doors: [
              { address: '1 A St', people: 1 },
              { address: '3 A St', people: 1 },
            ],
          },
        ])}
      />,
    )
    expect(screen.queryByText(/Showing the first/)).toBeNull()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        addressPreview={preview(
          [
            {
              doors: [
                { address: '1 A St', people: 1 },
                { address: '3 A St', people: 1 },
              ],
            },
          ],
          { stops: 900, doors: 2000, people: 4000 },
        )}
      />,
    )
    expect(
      screen.getByText('Showing the first 1 of 900 stops.'),
    ).toBeInTheDocument()
  })

  // The preview is a scan of people-db for one shape. Drawing must never
  // trigger one, so the panel is a request the page answers rather than
  // something the flow opens off state it already has.
  it('asks the page for the addresses instead of opening the panel itself', () => {
    const onShowAddresses = vi.fn()
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(2, 3)}
        onShowAddresses={onShowAddresses}
      />,
    )

    expect(document.getElementById('draw-step-doors')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'See the addresses' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(onShowAddresses).toHaveBeenCalledTimes(1)
  })

  // A list of addresses under a boundary that has since moved is the worst
  // reading this panel can produce: it looks like the answer and describes a
  // different shape. It is withdrawn, the counts fall back to the estimate,
  // and asking again is the candidate's press rather than an automatic
  // round trip on every vertex.
  it('withdraws a list whose boundary moved, and offers to ask again', () => {
    const onShowAddresses = vi.fn()
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={{
          stops: 14,
          people: 22,
          households: 9,
          partyMix: [],
          ageMix: [],
        }}
        previewStale
        onShowAddresses={onShowAddresses}
      />,
    )

    expect(screen.getByText(/Your boundary changed/)).toBeInTheDocument()
    expect(document.querySelectorAll('#draw-step-doors li')).toHaveLength(0)
    expect(screen.getByText('9')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Show the addresses here' }),
    )
    expect(onShowAddresses).toHaveBeenCalledTimes(1)
  })

  // A failed lookup leaves the estimate standing rather than blanking the
  // step: the shape is still drawable and still savable without it.
  it('offers a retry when the lookup fails', () => {
    const onRetryAddresses = vi.fn()
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={{
          stops: 14,
          people: 22,
          households: 9,
          partyMix: [],
          ageMix: [],
        }}
        previewFailed
        onRetryAddresses={onRetryAddresses}
      />,
    )

    expect(screen.getByText('9')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetryAddresses).toHaveBeenCalledTimes(1)
  })

  // Nothing to list, so nothing to offer: the button would spend a scan on a
  // shape that Continue already says holds no doors.
  it('offers no address list for a shape holding nothing', () => {
    render(
      <CreateListFlow {...baseProps} step="draw" turfStats={turfStats(0, 0)} />,
    )

    expect(
      screen.queryByRole('button', { name: 'See the addresses' }),
    ).toBeNull()
  })

  // One full-width Save, because there is one thing this step can do: name the
  // campaign and go on to the route. The pair it replaced — "Save and draw
  // another" beside "Save and exit" — both wrote a turf here, which is the
  // write that moved to the end of the flow.
  it('gives the confirm step a single Save that advances rather than writes', async () => {
    let posts = 0
    api.mock('POST /v1/voters/voter-file/filter', () => {
      posts += 1
      return { status: 200, data: { id: 3 } }
    })
    const onStepChange = vi.fn()

    render(
      <CreateListFlow
        {...baseProps}
        step="confirm"
        onStepChange={onStepChange}
      />,
    )

    expect(screen.queryByRole('button', { name: /^Save and/ })).toBeNull()
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Tuesday evening' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onStepChange).toHaveBeenCalledWith('route')
    expect(posts).toBe(0)
  })

  // The last step names the list it is about to buy a route for, so a
  // candidate reading it knows which of the evening's turfs they are spending
  // on. And the whole of what the press does is said under the title, because
  // it is the one press in the flow that cannot be undone.
  it('names the walk on the route step and says what Build route buys', () => {
    const { rerender } = render(
      <CreateListFlow {...baseProps} step="confirm" />,
    )
    advanceToRoute(rerender, {}, 'Lakeview blitz')

    expect(heading('Knock Lakeview blitz walk')).toBeInTheDocument()
    expect(
      screen.getByText(/This builds the route and locks the turf/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/frozen so everyone works from the same plan/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/You only do this once per turf/),
    ).toBeInTheDocument()
  })

  // The one press that spends money, so it says so while it is spending and
  // cannot be pressed twice.
  it('says Building route… while the purchase is in flight', async () => {
    let release: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 3 },
    })
    api.mock('POST /v1/door-knocking/turfs', async () => {
      await held
      return { status: 200 as const, data: savedTurf }
    })
    const onListCreated = vi.fn()

    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="confirm"
        onListCreated={onListCreated}
      />,
    )
    advanceToRoute(rerender, { onListCreated })
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    const building = await screen.findByRole('button', {
      name: 'Building route…',
    })
    expect(building).toBeDisabled()

    release!()
    await waitFor(() => expect(onListCreated).toHaveBeenCalled())
  })

  // The colour a list is drawn in is auto-assigned rather than asked for: the
  // confirm step is one name field, and the colour stays editable in
  // `EditTurfDialog`, which is where a candidate looking at the map is when
  // they discover two rings they want to tell apart.
  it('saves the colour it is handed rather than asking for one', async () => {
    let turfBody: unknown = null
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 3 },
    })
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      turfBody = body
      return { status: 200, data: savedTurf }
    })
    const onListCreated = vi.fn()
    const props = { color: '#16a34a', onListCreated }

    const { rerender } = render(
      <CreateListFlow {...baseProps} {...props} step="confirm" />,
    )

    expect(screen.queryByRole('button', { name: 'Green' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Blue' })).toBeNull()

    advanceToRoute(rerender, props)
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))
    await waitFor(() => expect(onListCreated).toHaveBeenCalled())
    // The colour the map was tinted with is the colour the turf is filed under.
    expect(turfBody).toMatchObject({ color: '#16a34a' })
  })

  // The three Win-only groups, and each one is a real 400 rather than a
  // preference: gp-api rejects a contacts-made selection
  // (`assertNoContactsMadeFilterForElectedOffice`) and a party filter
  // (`assertNoPartyFilterForElectedOffice`) from an `eo-` org outright, so
  // offering either only ever surfaces as a failed knock — an address preview
  // that never answers, then a create that cannot buy its route, with nothing
  // on screen naming the pill responsible.
  //
  // Voter likelihood joins them for the product reason rather than a licensing
  // one: it is turnout propensity for a contested election, which is not a
  // question an office holder has.
  it('hides the Win-only groups from an elected official', () => {
    const genderLabel = fieldLabel('gender')

    renderAtWho({ isServeOrg: true })
    buildNewList()

    for (const key of ['contacts_made', 'political_party', 'voter_likely']) {
      expect(screen.queryByLabelText(fieldLabel(key) as string)).toBeNull()
    }
    // A neighbour that stays, so the absences above are the Win-only rule
    // rather than a face of the step that never opened.
    expect(screen.getByLabelText(genderLabel as string)).toBeTruthy()
  })
})

// The step machinery the canvas asks for: one path of five steps to a bought
// route. Everything here is about the stepper being FIXED — door knocking has
// no ending that skips the boundary and the route, so no choice of audience
// may renumber the flow underneath the candidate making it.
describe('CreateListFlow steps', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.clearAllMocks()
  })

  const savedLists = [
    { id: 4, name: 'Precinct 2 homeowners', households: 820, filters: {} },
    { id: 9, name: 'Super voters', households: 1_240, filters: {} },
  ]

  it('opens on door knocking’s own goal cards, and picking one advances', () => {
    render(<CreateListFlow {...baseProps} step="filters" />)

    // Door knocking's own wording for the shared outreach purpose vocabulary
    // (docs/features/recommended-lists.md), not social's or phone banking's:
    // these goals are about a conversation on a doorstep and have no
    // equivalent on a channel that sends a message.
    expect(screen.getByText('Encourage early voting')).toBeInTheDocument()
    expect(screen.getByText('Turn out my supporters')).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /Encourage early voting/ }),
    )
    expect(heading('Who do you want to reach?')).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
  })

  // The reported defect, walked end to end at the step it was reported from:
  // totalSteps was derived from the audience, so touching a single filter pill
  // renumbered the flow underneath the candidate — "Step 2 of 5" became
  // "Step 2 of 3", promising an ending that saved a list and stopped. Both
  // audiences are walked because the old branch keyed off exactly the
  // difference between them.
  it('stays five steps long whether the audience is picked or cut by hand', async () => {
    const onStepChange = vi.fn()
    const props = { ...baseProps, savedLists, onStepChange }

    const { rerender } = renderAtWho(props)
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()

    await pickList(/Super voters/)
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()

    // The other audience: pills cut against the whole contact universe, with
    // no saved list behind them to shorten anything.
    buildNewList()
    rerender(
      <CreateListFlow
        {...props}
        step="filters"
        filters={{ partyDemocrat: true }}
      />,
    )
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()

    // And it really does continue to the map rather than to an ending of its
    // own — the stepper's promise and the flow's behaviour are the same claim.
    fireEvent.click(screen.getByRole('button', { name: 'Continue (1,500)' }))
    expect(onStepChange).toHaveBeenLastCalledWith('draw')

    rerender(
      <CreateListFlow
        {...props}
        step="draw"
        filters={{ partyDemocrat: true }}
      />,
    )
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument()
  })

  // One name per pass through the flow, and it is the campaign's. A hand-cut
  // audience used to be named on a step of its own between the who step and
  // the map; it is now filed by the create transaction under the campaign
  // name, so nothing before the confirm step asks for one.
  it('asks for the campaign’s name and no other, however the audience was cut', () => {
    const { rerender } = renderAtWho({ filters: { partyDemocrat: true } })

    expect(screen.queryByLabelText('List name')).toBeNull()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="confirm"
        filters={{ partyDemocrat: true }}
      />,
    )
    expect(screen.getByLabelText('Campaign name')).toBeInTheDocument()
    expect(screen.queryByLabelText('List name')).toBeNull()
  })

  it('numbers the draw, confirm and route steps as the last three of five', () => {
    const { rerender } = render(
      <CreateListFlow {...baseProps} step="draw" filters={{}} />,
    )
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument()

    rerender(<CreateListFlow {...baseProps} step="confirm" filters={{}} />)
    expect(screen.getByText('Step 4 of 5')).toBeInTheDocument()

    rerender(<CreateListFlow {...baseProps} step="route" filters={{}} />)
    expect(screen.getByText('Step 5 of 5')).toBeInTheDocument()
  })

  // The #1385 lesson: a card label doubling as a default title renamed live
  // records. The suggestion is its own record, so it reads as a list name
  // rather than as the goal it came from.
  it('seeds the campaign name from the purpose when no list was named', () => {
    const { rerender } = render(
      <CreateListFlow {...baseProps} step="filters" />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Turn out my supporters/ }),
    )
    rerender(<CreateListFlow {...baseProps} step="confirm" />)

    expect(screen.getByLabelText('Campaign name')).toHaveValue('Turnout walk')
  })

  // Every row is a name over its own door count, in the unit the walk is
  // measured in, so how big each audience is can be read without picking it.
  // The whole contact universe leads, because it is what the flow starts on.
  it('counts every list in the picker, in doors, under its name', async () => {
    const onFiltersChange = vi.fn()
    renderAtWho({
      savedLists,
      allContactsHouseholds: 12_000,
      onFiltersChange,
    })

    openPicker()
    const rows = await screen.findAllByRole('option')
    // The whole contact universe leads, because it is the audience the flow
    // opens on and the one every saved list is a narrowing of.
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('All contacts')
    expect(
      screen.getByRole('option', { name: /All contacts/ }),
    ).toHaveTextContent('12,000 doors')
    expect(
      screen.getByRole('option', { name: /Precinct 2 homeowners/ }),
    ).toHaveTextContent('820 doors')
    expect(
      screen.getByRole('option', { name: /Super voters/ }),
    ).toHaveTextContent('1,240 doors')

    fireEvent.click(screen.getByRole('option', { name: /Super voters/ }))

    // Picking a row closes the panel onto it, and lifts that list's own
    // filters into the draft.
    expect(audiencePicker()).toHaveTextContent('Super voters')
    expect(audiencePicker()).toHaveTextContent('1,240 doors')
    expect(onFiltersChange).toHaveBeenCalledWith({})
  })

  // The counts come from the pack, which decodes on its own schedule, so a row
  // waiting for one is the ordinary first frame rather than a broken list. It
  // is still pickable — the count is what the audience is, not whether it is.
  it('renders a list with no count yet rather than hiding it', async () => {
    renderAtWho({
      savedLists: [
        { id: 4, name: 'Precinct 2', households: null, filters: {} },
      ],
      allContactsHouseholds: null,
    })

    openPicker()
    expect(
      await screen.findByRole('option', { name: 'Precinct 2' }),
    ).toBeTruthy()
    expect(screen.getByRole('option', { name: 'All contacts' })).toBeTruthy()
  })

  // The reported defect, at the step it was reported from. A persuasion list
  // is narrowed by support status, and the pack has no plane for it — so
  // starting from a 256-person list put the whole district in the Continue
  // button and said nothing about why. The count itself cannot be fixed here
  // (the map genuinely cannot shade that clause), so the step has to say so:
  // an undisclosed superset is what made this read as the list being ignored.
  it('discloses, on the who step, a picked list’s unshadeable clauses', async () => {
    const { rerender } = renderAtWho({
      savedLists,
      districtHouseholds: 12_000,
      unpreviewableKeys: [],
    })
    expect(screen.queryByText(/can’t yet shade by/)).toBeNull()

    // Pick the row for real rather than posting the lifted draft in as props:
    // the sentence names the picked list, so a test that never picks one is
    // asserting wording the flow cannot actually reach.
    await pickList(/Precinct 2 homeowners/)
    rerender(
      <CreateListFlow
        {...baseProps}
        step="filters"
        savedLists={savedLists}
        districtHouseholds={12_000}
        filters={{ supportStatus: true }}
        unpreviewableKeys={['supportStatus']}
      />,
    )

    // The CTA's count is still the whole district here, which is the thing the
    // sentence below discloses.
    expect(
      screen.getByRole('button', { name: 'Continue (12,000)' }),
    ).toBeEnabled()
    expect(screen.getByText(/The map can’t yet shade by/)).toHaveTextContent(
      'The map can’t yet shade by Support status, so these counts include ' +
        'people that filter will exclude. Your saved list still applies it ' +
        'when you knock.',
    )
  })

  // The same sentence, one step earlier in the decision: a candidate who
  // builds a list from scratch and picks 65+ has an unshadeable selection and
  // no list to attribute it to. Citing "your saved list" there describes
  // something that does not exist; dropping the promise instead would end the
  // sentence on "that filter will exclude", which reads as the filter being
  // ignored. Both halves are checked because fixing either one alone is a
  // regression in the other.
  it('does not cite a saved list on the who step when none is picked', () => {
    renderAtWho({
      savedLists,
      districtHouseholds: 12_000,
      filters: { age65Plus: true },
      unpreviewableKeys: ['age65Plus'],
    })

    const disclosure = screen.getByText(/The map can’t yet shade by/)
    expect(disclosure).toHaveTextContent('Your list still applies it when you')
    expect(disclosure).not.toHaveTextContent('saved list')
  })

  // Picking a list is two writes that have to happen together, and the second
  // one is what the preview reads. A list whose only narrowing is a clause the
  // draft cannot hold must still arrive marked, or the who step has nothing to
  // disclose and the map shades the district.
  it('lifts a picked list’s whole draft, marks and all', async () => {
    const onFiltersChange = vi.fn()
    renderAtWho({
      savedLists: [
        {
          id: 4,
          name: 'Persuasion walk list',
          households: 12_000,
          filters: { supportStatus: true },
        },
      ],
      onFiltersChange,
    })

    await pickList(/Persuasion walk list/)

    expect(onFiltersChange).toHaveBeenCalledWith({ supportStatus: true })
  })

  // Editing a pill leaves the named list behind, so its own clauses go with
  // it: nothing can carry them onto the new list the flow is now offering to
  // save, and a disclosure about a filter that list will not apply is a lie in
  // the other direction.
  it('drops the marks when a pill edit leaves the named list behind', () => {
    const onFiltersChange = vi.fn()
    renderAtWho({
      savedLists,
      filters: { supportStatus: true, partyDemocrat: true },
      onFiltersChange,
    })
    buildNewList()

    fireEvent.click(screen.getByRole('button', { name: 'Republican' }))

    // The draft the pill wrote, not any of the writes that reached the filters
    // in the first place — an earlier call carrying no marks would satisfy a
    // looser assertion while the pill went on preserving them.
    const edited = onFiltersChange.mock.calls.at(-1)?.[0]
    expect(edited).not.toHaveProperty('supportStatus')
    expect(edited).toMatchObject({
      partyDemocrat: true,
      partyRepublican: true,
    })
  })

  // What OutreachFlowShell buys this flow: closing one someone has put work
  // into asks first, and a pristine one still closes on the first press.
  it('confirms a discard only once there is something to discard', () => {
    const onClose = vi.fn()
    // Pristine means no shape either — a ring is work, however it got there.
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="filters"
        ring={null}
        drawPointCount={0}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(
      <CreateListFlow
        {...baseProps}
        step="filters"
        ring={null}
        drawPointCount={0}
        filters={{ partyDemocrat: true }}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Discard changes?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  // A list picked on the who step already IS a `voter-file/filter`, and its id
  // is the one a turf attaches by. Filing a copy per shape would leave the CRM
  // holding a near-identical list for every turf cut from the same audience,
  // and the details sheet resolving turfs to lists nobody made.
  it('attaches the turf to the list that was picked, without copying it', async () => {
    let filterPosts = 0
    let turfBody: unknown = null
    api.mock('POST /v1/voters/voter-file/filter', () => {
      filterPosts += 1
      return { status: 200, data: { id: 999 } }
    })
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      turfBody = body
      return { status: 200, data: savedTurf }
    })
    // Nothing is deleted either: the cleanup ref means "a list this flow
    // minted", and the candidate's own list is not that.
    const deletes = vi.fn()
    api.mock('DELETE /v1/voters/voter-file/filter/:id', () => {
      deletes()
      return { status: 200, data: {} }
    })
    const onListCreated = vi.fn()
    const props = { ...baseProps, savedLists, onListCreated }

    const { rerender } = renderAtWho(props)
    await pickList(/Super voters/)
    fireEvent.click(screen.getByRole('button', { name: 'Continue (1,500)' }))

    rerender(<CreateListFlow {...props} step="confirm" />)
    advanceToRoute(rerender, props)
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    await waitFor(() => expect(onListCreated).toHaveBeenCalled())
    expect(filterPosts).toBe(0)
    expect(turfBody).toMatchObject({
      voterFileFilterId: 9,
      name: 'Tuesday evening',
    })
    expect(deletes).not.toHaveBeenCalled()
  })

  // The suggestion follows the goal while the box is untouched, and stops the
  // moment it is typed in. #1385: a card label doubling as a default title is
  // how a copy correction renamed live campaigns.
  it('re-seeds the campaign name from a new goal, and never over a typed one', () => {
    const { rerender } = render(
      <CreateListFlow {...baseProps} step="filters" />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Turn out my supporters/ }),
    )
    rerender(<CreateListFlow {...baseProps} step="confirm" />)
    expect(screen.getByLabelText('Campaign name')).toHaveValue('Turnout walk')

    // Back to the goal cards, pick another, forward again.
    rerender(<CreateListFlow {...baseProps} step="filters" />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(
      screen.getByRole('button', { name: /Encourage early voting/ }),
    )
    rerender(<CreateListFlow {...baseProps} step="confirm" />)
    expect(screen.getByLabelText('Campaign name')).not.toHaveValue(
      'Turnout walk',
    )

    // One keystroke and the box is theirs: a third goal upstream leaves it.
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Tuesday evening' },
    })
    rerender(<CreateListFlow {...baseProps} step="filters" />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(
      screen.getByRole('button', { name: /Turn out my supporters/ }),
    )
    rerender(<CreateListFlow {...baseProps} step="confirm" />)
    expect(screen.getByLabelText('Campaign name')).toHaveValue(
      'Tuesday evening',
    )
  })

  // Back from the draw step returns to the audience, which is the step
  // immediately in front of the map on the only path there is — and the page
  // hears `filters` for it, which is what resets the address panel.
  it('returns from the draw step to the who step', () => {
    const onStepChange = vi.fn()
    const savedLists = [
      { id: 4, name: 'Precinct 2 homeowners', households: 820, filters: {} },
    ]
    const props = { ...baseProps, savedLists, onStepChange }

    const { rerender } = renderAtWho(props)
    fireEvent.click(screen.getByRole('button', { name: 'Continue (1,500)' }))
    expect(onStepChange).toHaveBeenCalledWith('draw')

    rerender(<CreateListFlow {...props} step="draw" />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    // The page hears `filters`, which is what resets the address panel; the
    // flow remembers which of the two pre-draw stages it was on.
    expect(onStepChange).toHaveBeenLastCalledWith('filters')

    rerender(<CreateListFlow {...props} step="filters" />)
    expect(heading('Who do you want to reach?')).toBeInTheDocument()
  })

  // Back from the route step returns to the confirm step, which is the last
  // place the campaign's name can still be changed before it is bought.
  it('returns from the route step to the campaign name', () => {
    const onStepChange = vi.fn()
    const props = { onStepChange }

    const { rerender } = render(
      <CreateListFlow {...baseProps} {...props} step="confirm" />,
    )
    advanceToRoute(rerender, props, 'Lakeview blitz')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onStepChange).toHaveBeenLastCalledWith('confirm')

    rerender(<CreateListFlow {...baseProps} {...props} step="confirm" />)
    expect(screen.getByLabelText('Campaign name')).toHaveValue('Lakeview blitz')
  })
})

// The other end of the outreach hub's door-knocking tile: a candidate who
// pressed "Door knocking" with a list selected arrives on `?listId=` and must
// not be asked for that list a second time. The param is never trusted — the
// picker's own rows are, because they are the only thing that knows which
// lists this org still has.
describe('CreateListFlow preselected list', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.clearAllMocks()
  })

  const savedLists: SavedListOption[] = [
    { id: 4, name: 'Precinct 2 homeowners', households: 820, filters: {} },
    {
      id: 9,
      name: 'Super voters',
      households: 1_240,
      filters: { partyDemocrat: true },
    },
  ]

  it('opens the who step on the carried list, with its filters in the draft', () => {
    const onFiltersChange = vi.fn()
    renderAtWho({ savedLists, preselectedListId: 9, onFiltersChange })

    const picker = audiencePicker()
    expect(picker).toHaveTextContent('Super voters')
    expect(picker).toHaveTextContent('1,240 doors')
    // Seeded exactly as a click on the row seeds it — the pills and the map
    // say what the list says, not what the draft happened to hold.
    expect(onFiltersChange).toHaveBeenCalledWith({ partyDemocrat: true })
    // Arriving with the audience already chosen skips no step of the flow:
    // the boundary and the route are still ahead of it.
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
  })

  // The four ways a query param can be wrong that survive the parser — an id
  // that is simply not one of this org's lists (deleted, archived, another
  // org's, or invented) — all land here, and all of them must be nothing more
  // than a missed preselection.
  it('falls back to the ordinary flow when the id names no list of yours', () => {
    const onFiltersChange = vi.fn()
    renderAtWho({
      savedLists,
      preselectedListId: 12_345,
      filters: { partyDemocrat: true },
      onFiltersChange,
    })

    const picker = audiencePicker()
    expect(picker).toHaveTextContent('All contacts')
    expect(picker).toHaveTextContent('12,000 doors')
    expect(onFiltersChange).not.toHaveBeenCalled()
    // A missed preselection is the ordinary flow and nothing else — same
    // audience the flow opens on, same five steps in front of it.
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
  })

  it('leaves the flow untouched with no list carried in', () => {
    const onFiltersChange = vi.fn()
    renderAtWho({ savedLists, onFiltersChange })

    expect(audiencePicker()).toHaveTextContent('All contacts')
    expect(onFiltersChange).not.toHaveBeenCalled()
  })

  // This flow is unmounted every time the create surface closes, so it cannot
  // remember that the arrival is spent. Reporting the moment it lands is what
  // lets the page above stop offering it back — and it is reported only when
  // the id really was applied, so a bad one leaves the page still holding it
  // for the rows that may yet arrive.
  it('reports the carried list the moment it is applied, and not before', () => {
    const onPreselectApplied = vi.fn()
    renderAtWho({ savedLists, preselectedListId: 9, onPreselectApplied })

    expect(onPreselectApplied).toHaveBeenCalledTimes(1)
  })

  it('reports nothing when the carried list names no list of yours', () => {
    const onPreselectApplied = vi.fn()
    renderAtWho({ savedLists, preselectedListId: 12_345, onPreselectApplied })

    expect(onPreselectApplied).not.toHaveBeenCalled()
  })

  // The picker is populated by a query, so an empty first render is the
  // ordinary case rather than a refusal — the preselect has to wait for it
  // instead of deciding the id is bad.
  it('applies the carried list once the picker’s rows arrive', () => {
    const onFiltersChange = vi.fn()
    const props = { ...baseProps, preselectedListId: 9, onFiltersChange }

    const { rerender } = render(
      <CreateListFlow {...props} step="filters" savedLists={[]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Introduce myself/ }))
    expect(audiencePicker()).toHaveTextContent('All contacts')

    rerender(
      <CreateListFlow {...props} step="filters" savedLists={savedLists} />,
    )

    expect(audiencePicker()).toHaveTextContent('Super voters')
    expect(onFiltersChange).toHaveBeenCalledWith({ partyDemocrat: true })
  })

  // A seed, not a binding: the arrival is spent once applied, so a refetch
  // that hands back a fresh array cannot put the candidate's own pick back.
  it('does not re-apply over a list the candidate picked instead', async () => {
    const props = { ...baseProps, savedLists, preselectedListId: 9 }
    const { rerender } = render(<CreateListFlow {...props} step="filters" />)
    fireEvent.click(screen.getByRole('button', { name: /Introduce myself/ }))

    await pickList(/Precinct 2 homeowners/)
    expect(audiencePicker()).toHaveTextContent('Precinct 2 homeowners')

    rerender(
      <CreateListFlow
        {...props}
        step="filters"
        savedLists={savedLists.map((list) => ({ ...list }))}
      />,
    )

    expect(audiencePicker()).toHaveTextContent('Precinct 2 homeowners')
    expect(audiencePicker()).not.toHaveTextContent('Super voters')
  })

  // The whole point of carrying it: the turf attaches to the list the
  // candidate arrived with, rather than to a near-identical copy of it.
  it('attaches the turf to the carried list without copying it', async () => {
    let filterPosts = 0
    let turfBody: unknown = null
    api.mock('POST /v1/voters/voter-file/filter', () => {
      filterPosts += 1
      return { status: 200, data: { id: 999 } }
    })
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      turfBody = body
      return { status: 200, data: savedTurf }
    })
    const onListCreated = vi.fn()
    const props = {
      ...baseProps,
      savedLists,
      preselectedListId: 9,
      onListCreated,
    }

    const { rerender } = renderAtWho(props)
    fireEvent.click(screen.getByRole('button', { name: 'Continue (1,500)' }))

    rerender(<CreateListFlow {...props} step="confirm" />)
    advanceToRoute(rerender, props)
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    await waitFor(() => expect(onListCreated).toHaveBeenCalled())
    expect(filterPosts).toBe(0)
    expect(turfBody).toMatchObject({ voterFileFilterId: 9 })
  })
})

// The goal cards are the shared outreach step (outreach/v2/PurposeStep), and
// door knocking is ONE route for both rails — so which vocabulary they carry
// is the surface's answer, not the route's.
describe('CreateListFlow purpose step', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.clearAllMocks()
  })

  const renderPurpose = (serveMode: boolean) =>
    render(
      <DoorKnockingSurfaceProvider value={serveMode}>
        <CreateListFlow {...baseProps} step="filters" />
      </DoorKnockingSurfaceProvider>,
    )

  it('shows the Win goals on the Win surface', () => {
    renderPurpose(false)

    expect(screen.getByText('Persuade undecided voters')).toBeInTheDocument()
    expect(screen.getByText('Encourage early voting')).toBeInTheDocument()
    expect(screen.getByText('Turn out my supporters')).toBeInTheDocument()
    expect(screen.queryByText('Explain a recent decision')).toBeNull()
  })

  it('shows the Serve goals on the Serve surface', () => {
    renderPurpose(true)

    expect(screen.getByText('Explain a recent decision')).toBeInTheDocument()
    expect(screen.getByText('Ask for community input')).toBeInTheDocument()
    expect(screen.getByText('Share a resource or service')).toBeInTheDocument()
    // The three election-mechanics goals have no Serve meaning at all.
    expect(screen.queryByText('Persuade undecided voters')).toBeNull()
    expect(screen.queryByText('Encourage early voting')).toBeNull()
    expect(screen.queryByText('Turn out my supporters')).toBeNull()
  })

  // The per-card second line is gone with the bespoke card: no other channel
  // has one, and the step is now literally the other channels' component.
  it('draws a card as a label alone', () => {
    renderPurpose(false)

    expect(screen.getByText('Introduce myself')).toBeInTheDocument()
    expect(
      screen.queryByText('Meet voters who do not know you yet.'),
    ).toBeNull()
    expect(
      screen.queryByText('Talk with voters who could still swing your way.'),
    ).toBeNull()
  })

  // The flow renders the intro block once for the whole flow, so importing a
  // step that draws its own would say the stage title twice.
  it('draws the intro block once', () => {
    renderPurpose(false)

    expect(
      screen.getAllByRole('heading', {
        level: 3,
        name: 'What do you want to do?',
      }),
    ).toHaveLength(1)
  })

  // The confirm step's suggested name follows the surface too — a Serve goal
  // has no Win name suggestion to fall back on.
  it('suggests the Serve name for a Serve goal', () => {
    const { rerender } = render(
      <DoorKnockingSurfaceProvider value>
        <CreateListFlow {...baseProps} step="filters" />
      </DoorKnockingSurfaceProvider>,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Explain a recent decision/ }),
    )

    rerender(
      <DoorKnockingSurfaceProvider value>
        <CreateListFlow {...baseProps} step="confirm" />
      </DoorKnockingSurfaceProvider>,
    )

    expect(screen.getByLabelText('Campaign name')).toHaveValue(
      'Decision update walk',
    )
  })
})

// The word for the people on the map. An elected official already represents
// them, so nothing here waits on an election to call them constituents — and
// this flow is where a Serve list is built, which makes it the first place the
// Win word would be read.
describe('CreateListFlow on the Serve surface', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.clearAllMocks()
  })

  const renderServeAtWho = (
    props: Partial<ComponentProps<typeof CreateListFlow>> = {},
  ) => {
    const view = render(
      <DoorKnockingSurfaceProvider value>
        <CreateListFlow {...baseProps} step="filters" {...props} />
      </DoorKnockingSurfaceProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Introduce myself/ }))
    return view
  }

  it('waits on a constituent map rather than a voter map', () => {
    renderServeAtWho({
      districtHouseholds: 0,
      districtHouseholdsPending: true,
    })

    expect(
      screen.getByText(
        /Loading your constituent map…\s*Large districts can take up to 30 seconds\./,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/voter map/)).toBeNull()
  })

  it('names the constituent map in both ways the count can be absent', () => {
    const { unmount } = renderServeAtWho({
      districtHouseholds: 0,
      districtHouseholdsFailed: true,
    })

    expect(
      screen.getByText(
        'The constituent map could not load. Refresh to try again.',
      ),
    ).toBeInTheDocument()
    unmount()

    renderServeAtWho({ districtHouseholds: 0, districtUnavailable: true })

    expect(
      screen.getByText(/Constituent data is not available for this office yet/),
    ).toBeInTheDocument()
  })

  it('counts constituents behind a door, singular and plural', () => {
    render(
      <DoorKnockingSurfaceProvider value>
        <CreateListFlow
          {...baseProps}
          step="draw"
          addressPreview={preview([
            { doors: [{ address: '1 A St', people: 1 }] },
            { doors: [{ address: '3 A St', people: 4 }] },
          ])}
        />
      </DoorKnockingSurfaceProvider>,
    )

    expect(screen.getByText(/1 constituent$/)).toBeInTheDocument()
    expect(screen.getByText(/4 constituents$/)).toBeInTheDocument()
    expect(screen.queryByText(/\bvoters?$/)).toBeNull()
  })
})

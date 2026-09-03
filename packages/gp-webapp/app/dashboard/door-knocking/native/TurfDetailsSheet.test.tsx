import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  DoorKnockingRoutePayload,
  DoorKnockingTurf,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import TurfDetailsSheet from './TurfDetailsSheet'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// The test renderer wraps only QueryClientProvider, and useSnackbar throws
// outside its provider.
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))
const successSnackbar = vi.fn()
const errorSnackbar = vi.fn()
vi.mocked(useSnackbar).mockReturnValue({
  successSnackbar,
  errorSnackbar,
} as unknown as ReturnType<typeof useSnackbar>)

const turf = (overrides: Partial<DoorKnockingTurf> = {}): DoorKnockingTurf => ({
  id: 1,
  voterFileFilterId: 7,
  name: 'Elm St & 5th',
  color: '#2563eb',
  geoPoly: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  },
  doorCount: 2,
  peopleCount: 3,
  loggedCount: 0,
  knockedDoorCount: 0,
  routeSeconds: 1_860,
  completed: false,
  archivedAt: null,
  createdAt: new Date('2026-07-21T00:00:00Z'),
  updatedAt: new Date('2026-07-21T00:00:00Z'),
  ...overrides,
})

const routePayload: DoorKnockingRoutePayload = {
  route: {
    id: 5,
    doorKnockingTurfId: 1,
    mode: 'walk',
    loop: true,
    totalSeconds: 1860,
    totalMeters: 2400,
    stopCount: 2,
    createdAt: new Date('2026-07-21T00:00:00Z'),
  },
  pathGeometry: null,
  stops: [],
}

const resident = {
  personId: 'person-1',
  name: 'Dorian Fen',
  age: 31,
  politicalParty: null,
  cellPhone: null,
  landline: null,
  mayHaveMoved: false,
  knockStatus: 'unknown' as const,
  doNotKnock: false,
}

// One stop, two doors behind it, three people — the three counts a route
// reports separately, all distinct so a test can tell which one is rendered.
const routeWithDoors: DoorKnockingRoutePayload = {
  ...routePayload,
  stops: [
    {
      id: 10,
      seq: 1,
      lat: 36.16,
      lng: -86.78,
      displayAddress: '105 Elm St',
      legSeconds: 0,
      legMeters: 0,
      addresses: [
        {
          addressKey: '105|elm|st|1',
          address: '105 Elm St Apt 1',
          otherResidents: [],
          targets: [{ ...resident, stopTargetId: 21 }],
        },
        {
          addressKey: '105|elm|st|2',
          address: '105 Elm St Apt 2',
          otherResidents: [],
          targets: [
            { ...resident, stopTargetId: 22, personId: 'person-2' },
            { ...resident, stopTargetId: 23, personId: 'person-3' },
          ],
        },
      ],
    },
  ],
}

// `live` is what GET /turfs reports, which is what the affordance reads —
// separate from the prop so the stale-snapshot case is expressible.
const renderSheet = ({
  prop = {},
  live,
  onClose = vi.fn(),
  onKnock = vi.fn(),
  savedLists = [],
}: {
  prop?: Partial<DoorKnockingTurf>
  live?: Partial<DoorKnockingTurf>
  onClose?: () => void
  onKnock?: (turf: DoorKnockingTurf) => void
  savedLists?: Record<string, unknown>[]
} = {}) => {
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    // The saved list rows carry one boolean per filter option; the fixtures
    // below set only the handful each assertion is about.
    data: savedLists as never,
  })
  api.mock('GET /v1/door-knocking/turfs', {
    status: 200,
    data: [turf(live ?? prop)],
  })
  render(
    <TurfDetailsSheet turf={turf(prop)} onClose={onClose} onKnock={onKnock} />,
  )
  return { onClose, onKnock }
}

// The Overview grid tells its cells apart by their labels alone, so a figure is
// read out of the card its own label sits in — several of them legitimately
// print the same value as their neighbours.
const metric = (label: string) =>
  screen.getByText(label).closest('[data-slot="card"]') as HTMLElement

// The canvas draws a status indicator beside the name in BOTH details drawers,
// and the outreach one has always rendered it while this one rendered nothing —
// so a candidate could open Details on a finished list and find no statement of
// that anywhere on the surface. Same component as the outreach drawer, so one
// list cannot be described in two vocabularies from two entry points.
describe('TurfDetailsSheet status', () => {
  beforeEach(() => {
    testQueryClient.clear()
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
  })

  it.each<[string, Partial<DoorKnockingTurf>]>([
    ['Not started', { knockedDoorCount: 0 }],
    ['In progress', { knockedDoorCount: 1 }],
    ['Done', { knockedDoorCount: 2, completed: true }],
    [
      'Archived',
      {
        knockedDoorCount: 2,
        completed: true,
        archivedAt: new Date('2026-08-22T00:00:00Z'),
      },
    ],
  ])('names a %s list in the header', async (label, prop) => {
    renderSheet({ prop })

    expect(
      await screen.findByRole('heading', { name: 'Elm St & 5th' }),
    ).toBeInTheDocument()
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  // The channel the list belongs to, in the badge the outreach history table
  // draws for the same list — a drawer that named the channel its own way from
  // this entry point would be a second vocabulary for one walk.
  it('names the channel and what the drawer is for', async () => {
    renderSheet()

    // Scoped to the line the badge sits on: Overview states the same channel
    // as one of its own metrics, which is a different claim about the same
    // list rather than a second copy of this one.
    const byline = await screen.findByText(
      'Overview of this list, its route, and progress.',
    )
    expect(
      within(byline.parentElement as HTMLElement).getByText('Door knocking'),
    ).toBeInTheDocument()
  })
})

// The prop is the snapshot the page captured when the row was clicked, and the
// sheet outlives it: a list can be renamed here, or knocked from another
// surface, while the drawer is open. Anything that gates behavior or that this
// surface can edit therefore reads the live row from GET /turfs instead.
describe('TurfDetailsSheet live row', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  // This sheet can rename the list, so a header and an edit control named from
  // the click-time snapshot would go on offering to edit "Elm St & 5th" on a
  // list renamed to Riverside loop a moment earlier.
  it('names the live list, not the snapshot', async () => {
    renderSheet({
      prop: { name: 'Elm St & 5th' },
      live: { name: 'Riverside loop' },
    })

    expect(
      await screen.findByRole('heading', { name: 'Riverside loop' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Edit Riverside loop' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Elm St & 5th' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Edit Elm St & 5th' }),
    ).toBeNull()
  })

  // Same stale snapshot, other direction: the counts the walk moves are read
  // live, so a door logged from the phone while this sheet was open shows up.
  it('reports the live progress, not the snapshot', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
    renderSheet({
      prop: { doorCount: 40, knockedDoorCount: 0 },
      live: { doorCount: 40, knockedDoorCount: 12 },
    })

    expect(await screen.findByText('12 of 40 · 30%')).toBeInTheDocument()
    expect(screen.queryByText('0 of 40 · 0%')).toBeNull()
  })
})

describe('TurfDetailsSheet overview', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  // Geoapify's `totalSeconds` is TRAVEL alone — the jobs we send carry no
  // per-stop duration — so printing it raw under a label reading "Estimated
  // time" undersold an evening by more than half. The knocking pace is added
  // to it instead, off the same helper the walk view's header reads, so the
  // two surfaces cannot quote one list two different evenings.
  //
  // There is no other branch left here. This sheet used to carry a whole
  // second set of figures derived from the voter pack, for a list drawn but
  // not yet bought; 3.0 buys the route in the transaction that creates the
  // list, so the frozen route is the only account of it that exists.
  it('adds the knocking to the vendor travel', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routeWithDoors,
    })
    renderSheet()

    // 31m of travel over two doors, plus those two doors at 45 an hour.
    expect(await screen.findByText('34m')).toBeInTheDocument()
    expect(screen.queryByText('31m')).toBeNull()
    expect(metric('Estimated time')).not.toHaveTextContent('travel')
    // Never hedged: these numbers came through the create transaction's own
    // evaluation of the polygon, so they ARE the audience rather than the
    // wider population a map preview could shade.
    expect(screen.queryByText(/^About /)).toBeNull()
    expect(within(metric('Households')).getByText('2')).toBeInTheDocument()
    expect(within(metric('People')).getByText('3')).toBeInTheDocument()
  })

  // ADR 0007 drops do-not-knock residents, so a route whose every resident is
  // flagged really does have 0 knockable people — and now that the frozen
  // route is the only source, the zero is reported rather than papered over.
  it('reports zero people for a route whose residents are all flagged', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: {
        ...routeWithDoors,
        stops: routeWithDoors.stops.map((stop) => ({
          ...stop,
          addresses: stop.addresses.map((address) => ({
            ...address,
            targets: address.targets.map((target) => ({
              ...target,
              doNotKnock: true,
            })),
          })),
        })),
      } satisfies DoorKnockingRoutePayload,
    })
    renderSheet()

    // The duration is what tells us the route landed — the labels are static.
    expect(await screen.findByText('34m')).toBeInTheDocument()
    expect(within(metric('People')).getByText('0')).toBeInTheDocument()
  })

  // Seven figures in a two-column grid, told apart by their labels alone. The
  // glyph is what makes the grid scannable, and it is decorative — the label
  // beside it already names the figure, so a screen reader must not meet it.
  it('marks each overview stat with the icon for its own quantity', () => {
    renderSheet()

    const icon = metric('Households').querySelector('svg')
    expect(icon).toBeInTheDocument()
    expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  // Every list HAS a route, so while the fetch is in flight the honest answer
  // is "loading" — never "not knocked yet", which described a state that no
  // longer exists and would be a lie that resolves.
  it('waits for the route rather than claiming the list was never knocked', async () => {
    // Never settles, so the sheet stays in its pending state.
    api.mock(
      'GET /v1/door-knocking/turfs/:id/route',
      () => new Promise(() => undefined),
    )
    renderSheet({ prop: { doorCount: 40, knockedDoorCount: 0 } })

    await waitFor(() =>
      expect(screen.getAllByText('Loading').length).toBeGreaterThan(0),
    )
    expect(screen.queryByText('Not knocked yet')).toBeNull()
  })

  // The same lie, except this one never resolves.
  it('says the route is unavailable when it fails to load', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 500,
      data: { message: 'boom' },
    })
    renderSheet({ prop: { doorCount: 40, knockedDoorCount: 0 } })

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
    expect(screen.queryByText('Not knocked yet')).toBeNull()
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
  })

  // The disclosure about filters the map cannot shade belonged to the
  // pack-derived preview: a shape's preview is a superset of who gets knocked,
  // and the create flow still says so while the shape is being drawn. These
  // numbers have no such gap, so the sentence would be inventing doubt.
  it('discloses nothing about unshadeable filters', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routeWithDoors,
    })
    renderSheet()

    await screen.findByText('34m')
    expect(screen.queryByText(/can.t yet shade by/)).toBeNull()
    expect(screen.queryByText(/because the map/)).toBeNull()
  })

  // The list's own name and colour, which is what the ring on the map is drawn
  // in — and the swatch is named for the colour rather than for the hex it
  // paints with, the same vocabulary the edit dialog picks in.
  it('names the list and the colour its ring is drawn in', async () => {
    renderSheet({ prop: { color: '#16a34a' } })

    expect(await screen.findByText('Green')).toBeInTheDocument()
    expect(within(metric('Name')).getByText('Elm St & 5th')).toBeInTheDocument()
    expect(
      within(metric('Channel')).getByText('Door knocking'),
    ).toBeInTheDocument()
  })

  // Unconditional, because every list has a route and therefore paper. The
  // compact `PDF` is the design's affordance HERE specifically — the walk and
  // the outreach drawer both carry the full-width sentence instead.
  it('always offers the PDF', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
    renderSheet()

    const link = await screen.findByRole('link', { name: 'PDF' })
    expect(link).toHaveAttribute('href', '/dashboard/door-knocking/print/1/pdf')
    fireEvent.click(link)
    expect(successSnackbar).toHaveBeenCalledWith('Walk sheet downloaded')
  })
})

// The two numbers the rail card's overline prints, off the same gp-api
// aggregate — a candidate who reads the card and then opens Details must not
// meet two accounts of one list's progress. They count DOORS on both sides, and
// they are the turf row's own figures rather than anything derived here, which
// is why they survive a route fetch that hasn't landed or has failed.
describe('TurfDetailsSheet progress', () => {
  beforeEach(() => {
    testQueryClient.clear()
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
  })

  // The bar is a picture of the value above it rather than a second claim, so
  // it is aria-hidden and holds no text — the only way to it is through the
  // section that owns it.
  const progressBar = () =>
    screen
      .getByText('Progress')
      .closest('section')
      ?.querySelector<HTMLElement>('.bg-primary') ?? null

  // Not home, inaccessible and refused all count as knocked and none of them is
  // a conversation, so the figure is stated bare — no verb at all, which is
  // what keeps it from disagreeing with the walk's own pill.
  it('states the doors knocked without claiming anyone was reached', () => {
    renderSheet({ prop: { doorCount: 40, knockedDoorCount: 12 } })

    expect(screen.getByText('12 of 40 · 30%')).toBeInTheDocument()
    expect(screen.queryByText(/reached/i)).toBeNull()
  })

  // One of three doors. The width and the printed percent come off one
  // expression, so this asserts they agree rather than that a bar exists.
  it('draws the bar at the percentage it prints', () => {
    renderSheet({ prop: { doorCount: 3, knockedDoorCount: 1 } })

    expect(screen.getByText('1 of 3 · 33%')).toBeInTheDocument()
    expect(progressBar()).toHaveStyle({ width: '33%' })
  })

  // Zero is a real answer here — a list nobody has started — so the bar is not
  // floored to a visible sliver. A hairline would draw a door that was never
  // knocked. It is also the only shape this state has now: the null-count
  // branch that read "Not knocked yet" described a list with no route, which
  // 3.0 cannot produce.
  it('draws the bar empty rather than as a sliver at zero', () => {
    renderSheet({ prop: { doorCount: 3, knockedDoorCount: 0 } })

    expect(screen.getByText('0 of 3 · 0%')).toBeInTheDocument()
    expect(progressBar()).toHaveStyle({ width: '0%' })
    expect(screen.queryByText('Not knocked yet')).toBeNull()
  })

  // The figure is the turf row's, so the route fetch the stats above hang off
  // cannot take the progress down with it in either of its two failure modes.
  it('keeps reporting progress while the route is loading', async () => {
    api.mock(
      'GET /v1/door-knocking/turfs/:id/route',
      () => new Promise(() => undefined),
    )
    renderSheet({ prop: { doorCount: 40, knockedDoorCount: 12 } })

    await waitFor(() =>
      expect(screen.getAllByText('Loading').length).toBeGreaterThan(0),
    )
    expect(screen.getByText('12 of 40 · 30%')).toBeInTheDocument()
  })

  it('keeps reporting progress when the route fails to load', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 500,
      data: { message: 'boom' },
    })
    renderSheet({ prop: { doorCount: 40, knockedDoorCount: 12 } })

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
    expect(screen.getByText('12 of 40 · 30%')).toBeInTheDocument()
  })
})

describe('TurfDetailsSheet applied filters', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  // The pills are what was ASKED FOR, and 'Unknown' is an option on eleven of
  // these fields while 'Yes' is on four — so a flat wrap of them named a
  // veterans-with-unknown-homeowner list "Yes, Unknown" and identified
  // neither. The group headings come from the same config the create flow
  // picks with, so a candidate reads their list back in the shape they built
  // it.
  it('groups the pills under the filter each one answers', async () => {
    renderSheet({
      savedLists: [
        {
          id: 7,
          partyDemocrat: true,
          veteranYes: true,
          homeownerUnknown: true,
        },
      ],
    })

    expect(await screen.findByText('Political Party')).toBeInTheDocument()
    expect(screen.getByText('Democrat')).toBeInTheDocument()
    // Both of these render as bare 'Yes'/'Unknown'; the heading above each is
    // the only thing that says which question it answers.
    expect(screen.getByText('Veteran Status')).toBeInTheDocument()
    expect(screen.getByText('Homeownership')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  // Income ranges persist as the range strings themselves and language as
  // codes, so neither arrives as an option key — they still have to land in
  // the group they belong to rather than in an "Other" bucket.
  it('still names the age ranges a list saved before ENG-10752 carries', async () => {
    renderSheet({
      // The pickers stopped offering these when the ranges were made mutually
      // exclusive, but saved rows kept them, so a list cut on age alone showed
      // no pills at all — indistinguishable from a list that filters nothing.
      savedLists: [{ id: 7, age35_50: true }],
    })

    expect(await screen.findByText('Age')).toBeInTheDocument()
    expect(screen.getByText('35-50')).toBeInTheDocument()
  })

  it('groups income ranges and languages with the rest', async () => {
    renderSheet({
      savedLists: [
        {
          id: 7,
          incomeRanges: ['$50k - $75k'],
          languageCodes: ['es'],
        },
      ],
    })

    expect(
      await screen.findByText('Household Income Range'),
    ).toBeInTheDocument()
    expect(screen.getByText('$50k - $75k')).toBeInTheDocument()
    expect(screen.getByText('Language')).toBeInTheDocument()
    expect(screen.getByText('Spanish')).toBeInTheDocument()
  })

  it('says so when a list applies no filters at all', async () => {
    renderSheet({ savedLists: [{ id: 7 }] })

    expect(await screen.findByText(/No filters applied/)).toBeInTheDocument()
  })

  // The saved list the turf was cut from, named above the criteria that built
  // it — the same two-tier anatomy the outreach drawer draws for a send.
  it('names the saved list this turf targets', async () => {
    renderSheet({ savedLists: [{ id: 7, name: 'Likely voters' }] })

    expect(await screen.findByText('Likely voters')).toBeInTheDocument()
    expect(screen.getByText('Audience')).toBeInTheDocument()
  })
})

// The household roster is gone, and this block is what replaces the six tests
// that encoded it. #1372 shipped it against a real report — aggregate counts,
// and no way to see WHICH doors — and the Voter Outreach 2.0 canvas reverses
// that: the list details drawer is an overview, the same drawer the outreach
// history table opens, and neither draws a per-door list. What was learned in
// between is that the roster answered a question the walk already answers
// better. `WalkSurface` lists the same doors in the order they are to be
// knocked, with the tap-through to a resident behind `PersonSheet`, and the
// printed PDF is the take-it-with-you copy — so the roster was a third listing
// of one route, and a third place for the flagged-resident and cap caveats to
// drift out of step with the other two.
//
// The invariant worth keeping from those six: this drawer reports about a
// list, never about the people in it.
describe('TurfDetailsSheet overview only', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  it('names no door and no resident from the frozen route', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routeWithDoors,
    })
    renderSheet()

    // Waiting on a route-derived stat is what makes the absences below an
    // observation about the rendered sheet rather than a race with the fetch.
    expect(await screen.findByText(/Walk route/)).toBeInTheDocument()
    expect(screen.queryByText('105 Elm St Apt 1')).toBeNull()
    expect(screen.queryByText('Doors in this list')).toBeNull()
    expect(
      screen.queryByText(/Street addresses arrive with the route/),
    ).toBeNull()
  })
})

// What the walk produced, per status, which the drawer refused to say until
// now. The refusal was that the seven counts would reprint the landing rail's
// canvass-status chips; what overturns it is that they are not the same
// quantity — the rail's chips are the voter pack's superset over the polygon,
// hedged as "About", and Details can be open on a list that is not the selected
// scope at all, while these come off the frozen route and are exact.
describe('TurfDetailsSheet status breakdown', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  const routeWithTargets = (
    targets: Partial<RoutePayloadTarget>[],
  ): DoorKnockingRoutePayload => ({
    ...routePayload,
    stops: [
      {
        id: 10,
        seq: 1,
        lat: 36.16,
        lng: -86.78,
        displayAddress: '105 Elm St',
        legSeconds: 0,
        legMeters: 0,
        addresses: [
          {
            addressKey: '105|elm|st',
            address: '105 Elm St',
            otherResidents: [],
            targets: targets.map((override, index) => ({
              ...resident,
              stopTargetId: 100 + index,
              personId: `person-${100 + index}`,
              ...override,
            })),
          },
        ],
      },
    ],
  })

  const mockOutcomes = (targets: Partial<RoutePayloadTarget>[]) =>
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routeWithTargets(targets),
    })

  // Scoped, because Progress above reports over the same route and both
  // sections legitimately print figures like '1' and '100%'.
  const breakdown = () =>
    screen.getByText('Status breakdown').closest('section') as HTMLElement
  // One status's row: the label sits in a `dt` beside the `dd` holding its
  // count and its share, so their shared parent is the row.
  const row = (label: string) =>
    within(breakdown()).getByText(label).closest('div') as HTMLElement

  // The table's denominator is the People stat, which is the whole reason it
  // can sit under it: one more reading of numbers already on the surface, not
  // a second account.
  it('reports each outcome as a share of the knockable people', async () => {
    mockOutcomes([
      { knockStatus: 'not_home' },
      { knockStatus: 'not_home' },
      { knockStatus: 'supporter' },
      { knockStatus: 'unknown' },
    ])
    renderSheet()

    await waitFor(() => expect(row('Not home')).toBeInTheDocument())
    expect(within(row('Not home')).getByText('2')).toBeInTheDocument()
    expect(within(row('Not home')).getByText('50%')).toBeInTheDocument()
    expect(within(row('Supporter')).getByText('25%')).toBeInTheDocument()
    expect(within(row('Support unknown')).getByText('25%')).toBeInTheDocument()
    expect(
      within(breakdown()).getByText('Based on 4 door knocking contacts'),
    ).toBeInTheDocument()
  })

  // The word this feature does not use, on the surface most tempted by it:
  // not-home, inaccessible and refused are all outcomes and none is a
  // conversation. The caption names the denominator instead.
  it('names its denominator without saying anyone was reached', async () => {
    mockOutcomes([{ knockStatus: 'refused' }])
    renderSheet()

    expect(
      await within(breakdown()).findByText('Based on 1 door knocking contact'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/reached/i)).toBeNull()
  })

  // A status nobody recorded is an answer, so the row renders at zero rather
  // than vanishing — the vocabulary is fixed, and a table whose rows come and
  // go would make its own shape a fact about the list.
  it('prints an unrecorded outcome as zero rather than dropping the row', async () => {
    mockOutcomes([{ knockStatus: 'supporter' }])
    renderSheet()

    await waitFor(() => expect(row('Refused')).toBeInTheDocument())
    expect(within(row('Refused')).getByText('0')).toBeInTheDocument()
    expect(within(row('Refused')).getByText('0%')).toBeInTheDocument()
    expect(within(row('Supporter')).getByText('100%')).toBeInTheDocument()
  })

  // One outcome is one colour everywhere in the feature — the map dots, the
  // walk's strip, the landing chips and this table all read
  // `STATUS_DOT_COLORS`, which is the whole reason the dot survived a redesign
  // that took the bars.
  it('marks each row with the status palette', async () => {
    mockOutcomes([{ knockStatus: 'not_home' }, { knockStatus: 'supporter' }])
    renderSheet()

    await waitFor(() => expect(row('Not home')).toBeInTheDocument())
    expect(row('Not home').querySelector('span[style]')).toHaveStyle({
      backgroundColor: '#eab308',
    })
    expect(row('Supporter').querySelector('span[style]')).toHaveStyle({
      backgroundColor: '#16a34a',
    })
  })

  // ADR 0008's follow-up is optional, so the status lands at Save and the
  // reason — the thing that actually drops the resident from every people
  // figure — may never be given. This bucket is therefore exactly the doors
  // where that outcome was logged and nobody has answered "what happened?", and
  // the line saying so appears only when there are any.
  it('explains the not-a-voter bucket when it holds anyone', async () => {
    mockOutcomes([{ knockStatus: 'not_a_voter' }, { knockStatus: 'supporter' }])
    renderSheet()

    await waitFor(() => expect(row('Not a voter')).toBeInTheDocument())
    expect(within(row('Not a voter')).getByText('50%')).toBeInTheDocument()
    expect(
      within(breakdown()).getByText(/nobody has said yet whether they moved/),
    ).toBeInTheDocument()
  })

  it('says nothing about it when nobody was logged not a voter', async () => {
    mockOutcomes([{ knockStatus: 'supporter' }])
    renderSheet()

    await waitFor(() => expect(row('Not a voter')).toBeInTheDocument())
    expect(within(row('Not a voter')).getByText('0%')).toBeInTheDocument()
    expect(
      screen.queryByText(/nobody has said yet whether they moved/),
    ).toBeNull()
  })

  // Answering the follow-up removes the resident from the table altogether
  // rather than moving them between rows, because it is the reason and not the
  // status that ADR 0008 counts as "nobody to talk to".
  it('drops a not-a-voter resident from the table once the reason is known', async () => {
    mockOutcomes([
      { knockStatus: 'not_a_voter', notAVoterReason: 'moved' },
      { knockStatus: 'supporter' },
    ])
    renderSheet()

    await waitFor(() => expect(row('Supporter')).toBeInTheDocument())
    expect(within(row('Supporter')).getByText('100%')).toBeInTheDocument()
    expect(within(row('Not a voter')).getByText('0%')).toBeInTheDocument()
    expect(
      screen.queryByText(/nobody has said yet whether they moved/),
    ).toBeNull()
  })

  // Two states rather than three, and neither of them is "not knocked yet":
  // every list has a route, so the table is either waiting for it or reporting
  // that it could not be read.
  it('shows a skeleton while the route is loading', async () => {
    api.mock(
      'GET /v1/door-knocking/turfs/:id/route',
      () => new Promise(() => undefined),
    )
    renderSheet({ prop: { doorCount: 3, knockedDoorCount: 0 } })

    await waitFor(() =>
      expect(within(breakdown()).getByText('Loading')).toBeInTheDocument(),
    )
    expect(screen.queryByText('Not knocked yet')).toBeNull()
  })

  it('reports the outcomes unavailable when the route fails', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 500,
      data: { message: 'boom' },
    })
    renderSheet()

    expect(
      await within(breakdown()).findByText(/Unavailable/),
    ).toBeInTheDocument()
    expect(within(breakdown()).queryByText(/Not knocked yet/)).toBeNull()
  })

  // The table is built over knockable people, so a route with none of them is a
  // fully flagged list rather than an empty one.
  it('says why a fully flagged route reports no outcomes', async () => {
    mockOutcomes([{ knockStatus: 'supporter', doNotKnock: true }])
    renderSheet()

    expect(
      await within(breakdown()).findByText(/no outcomes to report/),
    ).toBeInTheDocument()
    expect(within(breakdown()).queryByText('Supporter')).toBeNull()
  })
})

// The drawer reports the gesture and the orchestrator opens the walk. It costs
// nothing now — the route was bought when the list was created, so there is no
// dialog and no purchase between this button and the doors. Same handler the
// rail card's Knock button calls, so one list cannot be started two ways.
describe('TurfDetailsSheet knocking', () => {
  beforeEach(() => {
    testQueryClient.clear()
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
  })

  // "Continue" branches on anything having been logged, because a route bought
  // and never walked is still a walk that has not started — which is now the
  // state every list is born in.
  it('offers to start a route nobody has logged a door on', async () => {
    renderSheet({ prop: { doorCount: 40, knockedDoorCount: 0 } })

    expect(
      await screen.findByRole('button', { name: 'Start knocking' }),
    ).toBeInTheDocument()
  })

  it('offers to continue once a door has been logged', async () => {
    renderSheet({ prop: { doorCount: 40, knockedDoorCount: 12 } })

    expect(
      await screen.findByRole('button', { name: 'Continue knocking' }),
    ).toBeInTheDocument()
  })

  // The live row again: the orchestrator opens the knock dialog or the walk
  // against whatever it is handed, so a stale snapshot would start the walk
  // under the name the list no longer has.
  it('closes the drawer and hands the live row to the orchestrator', async () => {
    const { onClose, onKnock } = renderSheet({
      prop: { name: 'Elm St & 5th' },
      live: { name: 'Riverside loop' },
    })

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Riverside loop' }),
      ).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start knocking' }))

    expect(onClose).toHaveBeenCalled()
    expect(onKnock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: 'Riverside loop' }),
    )
  })
})

describe('TurfDetailsSheet edit', () => {
  beforeEach(() => {
    testQueryClient.clear()
    successSnackbar.mockClear()
    errorSnackbar.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  // The one control the design's footer has no room for, and the only way to
  // rename a list or change the colour its ring is drawn in. It is an icon, so
  // the list it edits is named in its label — which is also what keeps two
  // drawers' worth of pencils apart when the header is read out.
  const openEditor = async () => {
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit Elm St & 5th' }),
    )
    return screen.findByRole('textbox')
  }

  // Always available, which is the point of splitting the update endpoint's
  // fields. It used to hide the moment a route existed, because the endpoint
  // also accepted `geoPoly` and one `assertNotLocked` covered the whole call —
  // and since every list is now routed from birth, leaving that in place would
  // have meant no list was ever renameable again.
  it('offers edit on a list with a route', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
    renderSheet()

    expect(
      await screen.findByRole('button', { name: 'Edit Elm St & 5th' }),
    ).toBeInTheDocument()
  })

  it('saves a new name and color', async () => {
    let sent: { id?: string; body?: unknown } = {}
    api.mock('PUT /v1/door-knocking/turfs/:id', ({ params, body }) => {
      sent = { id: params.id, body }
      return { status: 200, data: turf({ name: 'Oak Ave', color: '#16a34a' }) }
    })
    renderSheet()

    const input = await openEditor()
    fireEvent.change(input, { target: { value: 'Oak Ave' } })
    // The swatch is named for the colour, not the hex it paints with — the
    // canvas labels its own swatches `opt.label`, and "two five six three e b"
    // is not a colour anyone can choose by ear.
    fireEvent.click(screen.getByRole('button', { name: 'Green' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sent.id).toBe('1'))
    expect(sent.body).toEqual({ name: 'Oak Ave', color: '#16a34a' })
    expect(successSnackbar).toHaveBeenCalledWith('List updated')
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.ListEdited, {
      turfId: 1,
      renamed: true,
      recolored: true,
    })
  })

  // The name is submitted trimmed, so a rename that only adds whitespace is not
  // a change at all and Save stays disabled.
  it('trims the name and treats whitespace as no change', async () => {
    renderSheet()

    const input = await openEditor()
    fireEvent.change(input, { target: { value: '  Elm St & 5th  ' } })

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('will not save an empty name', async () => {
    renderSheet()

    const input = await openEditor()
    fireEvent.change(input, { target: { value: '   ' } })

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('will not save when nothing changed', async () => {
    renderSheet()
    await openEditor()

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  // The header reads the live row, not the prop the page captured, or a rename
  // would not show up until the page happened to re-pass the turf.
  it('shows the renamed list in the header', async () => {
    api.mock('PUT /v1/door-knocking/turfs/:id', {
      status: 200,
      data: turf({ name: 'Oak Ave' }),
    })
    renderSheet()

    const input = await openEditor()
    fireEvent.change(input, { target: { value: 'Oak Ave' } })
    // After renderSheet, so this is what the post-save invalidation refetches
    // rather than the original name it seeded the sheet with.
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ name: 'Oak Ave' })],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Oak Ave' }),
      ).toBeInTheDocument(),
    )
  })

  // Every failure is retryable now, and the dialog stays put for all of them.
  // The 409 branch that used to close it belonged to `assertNotLocked`, which
  // the endpoint dropped when it stopped accepting the polygon.
  it('keeps the dialog open on a failure', async () => {
    api.mock('PUT /v1/door-knocking/turfs/:id', {
      status: 500,
      data: { message: 'boom' },
    })
    renderSheet()

    const input = await openEditor()
    fireEvent.change(input, { target: { value: 'Oak Ave' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/could not be updated/),
      ),
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
})

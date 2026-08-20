import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import {
  DoorKnockingRoutePayload,
  DoorKnockingTurf,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { PolygonStats } from './filterEngine'
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
  locked: false,
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
  listStats = null,
  listStatsPending = false,
  unpreviewableKeys = [],
  onDeleted = vi.fn(),
}: {
  prop?: Partial<DoorKnockingTurf>
  live?: Partial<DoorKnockingTurf>
  listStats?: PolygonStats | null
  listStatsPending?: boolean
  unpreviewableKeys?: string[]
  onDeleted?: () => void
} = {}) => {
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
  api.mock('GET /v1/door-knocking/turfs', {
    status: 200,
    data: [turf(live ?? prop)],
  })
  render(
    <TurfDetailsSheet
      turf={turf(prop)}
      listStats={listStats}
      listStatsPending={listStatsPending}
      unpreviewableKeys={unpreviewableKeys}
      onClose={vi.fn()}
      onDeleted={onDeleted}
    />,
  )
  return { onDeleted }
}

describe('TurfDetailsSheet delete', () => {
  beforeEach(() => {
    testQueryClient.clear()
    successSnackbar.mockClear()
    errorSnackbar.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  // gp-api's assertNotLocked 409s on a knocked turf, so offering the button
  // there would only ever produce an error.
  it('offers delete only while the turf is unlocked', () => {
    renderSheet({ prop: { locked: true } })
    expect(screen.queryByLabelText('Delete Elm St & 5th')).toBeNull()
  })

  // The prop is a snapshot taken when the row was clicked, so a turf knocked
  // since then must not still offer delete.
  it('retires the affordance when the live row is locked but the prop is stale', async () => {
    renderSheet({ prop: { locked: false }, live: { locked: true } })

    await waitFor(() =>
      expect(screen.queryByLabelText('Delete Elm St & 5th')).toBeNull(),
    )
  })

  // Same stale snapshot, other direction: the route exists once it's locked, so
  // gating the route query on the prop would report it as never knocked.
  it('loads the route for a turf locked since the sheet opened', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
    renderSheet({ prop: { locked: false }, live: { locked: true } })

    // 1860s of travel, rendered by the sheet's duration formatter. Anchored on
    // the duration arriving rather than on 'Not knocked yet' disappearing:
    // that copy is now absent for the whole fetch, so waiting for it to go
    // would pass before the route had loaded at all.
    expect(await screen.findByText('31m')).toBeInTheDocument()
    expect(screen.queryByText('Not knocked yet')).toBeNull()
  })

  // ADR 0007. Progress counts knockable doors, so a canvasser who correctly
  // skipped every flagged one still gets to 100% — and the number agrees with
  // the walk view's own counter rather than diverging from it.
  it('leaves flagged residents out of the progress stat', async () => {
    const target = {
      stopTargetId: 21,
      personId: 'person-1',
      name: 'Dorian Fen',
      age: 31,
      politicalParty: null,
      cellPhone: null,
      landline: null,
      mayHaveMoved: false,
    }
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: {
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
                targets: [
                  { ...target, knockStatus: 'supporter', doNotKnock: false },
                  {
                    ...target,
                    stopTargetId: 22,
                    personId: 'person-2',
                    knockStatus: 'unknown',
                    doNotKnock: true,
                  },
                ],
              },
            ],
          },
        ],
      } satisfies DoorKnockingRoutePayload,
    })
    renderSheet({ prop: { locked: true } })

    expect(await screen.findByText('1 of 1 · 100%')).toBeInTheDocument()
  })

  it('deletes after confirmation and hands the turf back to the page', async () => {
    let deletedId: string | undefined
    // The route really answers 204, but the mocker's success channel is typed
    // 200 and nothing here reads the status — only that it resolved.
    api.mock('DELETE /v1/door-knocking/turfs/:id', ({ params }) => {
      deletedId = params.id
      return { status: 200, data: undefined }
    })
    const { onDeleted } = renderSheet()

    fireEvent.click(screen.getByLabelText('Delete Elm St & 5th'))
    // The confirm lives in the dialog, so the trigger alone must not delete.
    expect(deletedId).toBeUndefined()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deletedId).toBe('1'))
    expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    expect(successSnackbar).toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.ListDeleted, {
      turfId: 1,
    })
  })

  // A 409 means someone knocked it mid-sheet, which is permanent. Leaving the
  // dialog open would re-enable a Delete that can only 409 again.
  it('closes the confirm and explains out of band on a 409', async () => {
    api.mock('DELETE /v1/door-knocking/turfs/:id', {
      status: 409,
      data: { message: 'frozen' },
    })
    const { onDeleted } = renderSheet()

    fireEvent.click(screen.getByLabelText('Delete Elm St & 5th'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/already been knocked/),
        expect.anything(),
      ),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull(),
    )
    expect(onDeleted).not.toHaveBeenCalled()
    // Nothing was deleted, so nothing to report.
    expect(trackEvent).not.toHaveBeenCalled()
  })

  // Unlike a 409, a transient failure is worth another attempt, so the dialog
  // holds its place with the reason inline.
  it('keeps the confirm open with an inline error on a generic failure', async () => {
    api.mock('DELETE /v1/door-knocking/turfs/:id', {
      status: 500,
      data: { message: 'boom' },
    })
    renderSheet()

    fireEvent.click(screen.getByLabelText('Delete Elm St & 5th'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Try again/)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(errorSnackbar).not.toHaveBeenCalled()
  })
})

const listStats = (overrides: Partial<PolygonStats> = {}): PolygonStats => ({
  stops: 41,
  households: 68,
  people: 213,
  partyMix: [],
  ...overrides,
})

describe('TurfDetailsSheet overview', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  // The number a candidate wants while deciding whether a list is a
  // reasonable evening — and building the route that would answer it exactly
  // is a billed, irreversible Geoapify call, so a saved list can't be made to
  // pay for its own estimate.
  it('estimates the evening from doors before a route exists', () => {
    renderSheet({ listStats: listStats() })

    // 68 doors at 45 an hour, the draw step's own rule of thumb.
    expect(screen.getByText('About 1 hr 31 min')).toBeInTheDocument()
    // Named, so it reads as a rule of thumb rather than a computed promise.
    expect(screen.getByText('at 45 doors an hour')).toBeInTheDocument()
    // 45 doors an hour is a knocking pace, conversations included.
    expect(screen.getByText('Knocking time')).toBeInTheDocument()
  })

  // Geoapify's own duration is the real answer once it has been paid for —
  // the rule of thumb retires rather than sitting beside it. It is also only
  // the travel between doors (the jobs we send carry no per-stop duration),
  // so it must not go on claiming to be the cost of the evening.
  it('labels the vendor duration as travel once the route is built', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routeWithDoors,
    })
    renderSheet({ prop: { locked: true }, listStats: listStats() })

    expect(await screen.findByText('31m')).toBeInTheDocument()
    expect(screen.getByText('Travel time')).toBeInTheDocument()
    expect(screen.queryByText('Knocking time')).toBeNull()
    expect(screen.queryByText(/doors an hour/)).toBeNull()
    expect(screen.queryByText(/^About /)).toBeNull()
    // The frozen route's two addresses, not the pack's 68 households.
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('68')).toBeNull()
  })

  // ADR 0007 drops do-not-knock residents, so a route whose every resident is
  // flagged really does have 0 knockable people. Falling back on the count
  // being empty rather than on the route existing answered that with the
  // pack's pre-route number.
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
    renderSheet({ prop: { locked: true }, listStats: listStats() })

    // The duration is what tells us the route landed — the labels are static.
    expect(await screen.findByText('31m')).toBeInTheDocument()
    expect(screen.getByText('0 of 0 · 0%')).toBeInTheDocument()
    expect(screen.queryByText('213')).toBeNull()
  })

  // Not home, inaccessible and refused all count as logged, and none of them
  // is a conversation — so the stat must not say anyone was reached.
  it('counts logged doors rather than claiming people were reached', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routeWithDoors,
    })
    renderSheet({ prop: { locked: true } })

    expect(await screen.findByText('People logged')).toBeInTheDocument()
    expect(screen.queryByText(/reached/i)).toBeNull()
  })

  // An empty shape has no evening to estimate, so the stat keeps its old copy
  // rather than promising "about 0 min".
  it('says not knocked yet when the shape holds no doors', () => {
    renderSheet({ listStats: null })

    expect(screen.getByText('Knocking time')).toBeInTheDocument()
    expect(screen.queryByText(/^About /)).toBeNull()
  })

  // The unlocked mirror of the locked-route case: these numbers come from the
  // pack, so before it decodes a null `listStats` means "not read yet", not
  // "no doors here" — rendering 0 doors and 'Not knocked yet' is the same
  // confident-but-wrong answer, and indistinguishable from the settled state.
  it('waits for the pack instead of reporting an empty shape', () => {
    renderSheet({ listStats: null, listStatsPending: true })

    // Doors, people, and the knocking estimate.
    expect(screen.getAllByText('Loading')).toHaveLength(3)
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByText(/doors an hour/)).toBeNull()
  })

  // Settled with nothing to show is a different claim from still loading: the
  // pack failed, the saved lists failed, or the list was deleted in the CRM.
  // savedListFilterKeys(undefined) is {}, which polygonStats reads as "no
  // filters" — so the tempting 0 here is really the unfiltered whole-polygon
  // count wearing a plausible face.
  it('says so when the audience settles without a count', () => {
    renderSheet({ listStats: null, listStatsPending: false })

    expect(screen.getAllByText('Unavailable')).toHaveLength(3)
    expect(
      screen.getByText(/audience could not be counted/),
    ).toBeInTheDocument()
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByText(/doors an hour/)).toBeNull()
  })

  // Route type and progress are true from lockedness alone, so they must not
  // flicker a skeleton every time the sheet opens.
  it('still answers route type and progress while the pack loads', () => {
    renderSheet({ listStats: null, listStatsPending: true })

    expect(screen.getByText('Route type')).toBeInTheDocument()
    expect(screen.getAllByText('Not knocked yet')).toHaveLength(2)
  })

  // Lockedness IS the frozen route row, so a locked list HAS been knocked.
  // Saying otherwise for the length of the fetch is a lie that resolves.
  it('waits for a locked list route instead of saying it was never knocked', async () => {
    // Never settles, so the sheet stays in its pending state.
    api.mock(
      'GET /v1/door-knocking/turfs/:id/route',
      () => new Promise(() => undefined),
    )
    renderSheet({ prop: { locked: true }, listStats: listStats() })

    await waitFor(() =>
      expect(screen.getAllByText('Loading').length).toBeGreaterThan(0),
    )
    expect(screen.queryByText('Not knocked yet')).toBeNull()
    // Nor the pack's pre-route answers, which would then swap out mid-load.
    expect(screen.queryByText('68')).toBeNull()
    expect(screen.queryByText('213')).toBeNull()
    expect(screen.queryByText(/doors an hour/)).toBeNull()
  })

  // The same lie, except this one never resolves.
  it('says the route is unavailable when it fails to load', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 500,
      data: { message: 'boom' },
    })
    renderSheet({ prop: { locked: true }, listStats: listStats() })

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
    expect(screen.queryByText('Not knocked yet')).toBeNull()
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
    expect(screen.queryByText(/doors an hour/)).toBeNull()
  })

  // These sit directly above the "Applied filters" pills, so an unqualified
  // count has to be the filtered one — the page computes them with the turf's
  // saved filters rather than with empty selections.
  // Hedged, because the pack shades only what it has buckets for and knocking
  // then applies the rest — activity conditions, support status, and the
  // do-not-knock / not-a-voter exclusions. An unqualified integer here reads as
  // the audience when it is really the wider population it is drawn from.
  it('reports the doors and people the list targets, as approximate', () => {
    renderSheet({ listStats: listStats() })

    expect(screen.getByText('Doors')).toBeInTheDocument()
    expect(screen.getByText('About 68')).toBeInTheDocument()
    expect(screen.getByText('People')).toBeInTheDocument()
    expect(screen.getByText('About 213')).toBeInTheDocument()
    expect(screen.queryByText('Doors in this area')).toBeNull()
    expect(screen.queryByText('People in this area')).toBeNull()
    expect(
      screen.getByText(/About, because the map can.t show every filter/),
    ).toBeInTheDocument()
  })

  // The frozen route's counts came through knock-time evaluation, so they ARE
  // the audience. Hedging them would invent doubt about the one exact number
  // this sheet has.
  it('states the frozen route counts exactly', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routeWithDoors,
    })
    renderSheet({ prop: { locked: true }, listStats: listStats() })

    expect(await screen.findByText('31m')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('About 2')).toBeNull()
    expect(screen.queryByText(/About, because the map/)).toBeNull()
  })

  // The rail's sentence verbatim, from the shared helper, on the surface that
  // reports the same numbers about the same list — and scoped to the MAP,
  // because gp-api applies 65+ as a real age bound at knock time. Read as "my
  // filter isn't working" it would be worse than the imprecision it fixes.
  it('names a filter the map cannot shade without impugning the filter', () => {
    renderSheet({ listStats: listStats(), unpreviewableKeys: ['age65Plus'] })

    const disclosure = screen.getByText(/The map can.t shade by/)
    expect(disclosure).toHaveTextContent(
      'The map can’t shade by 65+ yet, so these counts include people that filter will exclude. Your saved list still applies it when you knock.',
    )
  })

  it('says nothing about unshadeable filters when there are none', () => {
    renderSheet({ listStats: listStats() })

    expect(screen.queryByText(/can.t shade by/)).toBeNull()
  })

  // Same rule as the TurfList row: only a locked list has a route to print,
  // so the link would 404 on an unknocked one.
  it('offers the PDF on a locked list', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
    renderSheet({ prop: { locked: true } })

    const link = await screen.findByRole('link', { name: 'PDF' })
    expect(link).toHaveAttribute('href', '/dashboard/door-knocking/print/1/pdf')
  })

  it('hides the PDF on an unknocked list', () => {
    renderSheet()

    expect(screen.queryByRole('link', { name: 'PDF' })).toBeNull()
  })

  // The prop is the snapshot the page captured when the row was clicked, so a
  // turf knocked since then has paper to offer.
  it('offers the PDF when the live row is locked but the prop is stale', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
    renderSheet({ prop: { locked: false }, live: { locked: true } })

    expect(await screen.findByRole('link', { name: 'PDF' })).toBeInTheDocument()
  })
})

// The mode was chosen before the route existed and is permanent afterwards:
// door_knocking_route.doorKnockingTurfId is unique, the row is never written
// once the knock transaction commits, and every logged knock hangs off a
// stopTargetId belonging to its stops. So the flip is a reading of the frozen
// route, never a re-plan of it — and the stored pathGeometry belongs to the
// mode we actually bought, which is the one path we have.
describe('TurfDetailsSheet travel mode flip', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  const renderKnocked = () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: {
        ...routeWithDoors,
        pathGeometry: {
          type: 'LineString',
          coordinates: [
            [-86.78, 36.16],
            [-86.781, 36.161],
          ],
        },
      } satisfies DoorKnockingRoutePayload,
    })
    renderSheet({ prop: { locked: true } })
    return screen.findByText('31m')
  }

  it('re-estimates the travel time for the mode that was not bought', async () => {
    await renderKnocked()

    // Geoapify's own figure for the walk route it planned.
    expect(screen.getByText('Travel time')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Walking' })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: 'Driving' }))

    // 2400m of bought path, read at driving speed — ours, and labelled ours.
    expect(screen.getByText('About 6m')).toBeInTheDocument()
    expect(screen.queryByText('31m')).toBeNull()
    expect(
      screen.getByText('our estimate, at driving speed'),
    ).toBeInTheDocument()
  })

  // The one thing this must never imply. There is no second path: we bought the
  // walking directions and nothing re-plans them.
  it('says the route itself is unchanged', async () => {
    await renderKnocked()
    fireEvent.click(screen.getByRole('radio', { name: 'Driving' }))

    const note = screen.getByText(/Nothing has been re-planned/)
    expect(note).toHaveTextContent(/built for walking/)
    expect(note).toHaveTextContent(
      /the stops, their order and the path on the map are unchanged/,
    )
    // And the frozen artifact keeps naming itself, rather than the flip
    // relabelling it as a drive route it is not.
    expect(screen.getByText('Walk route · loop')).toBeInTheDocument()
    expect(screen.queryByText(/Drive route/)).toBeNull()
  })

  it('puts the vendor figure back when flipped home', async () => {
    await renderKnocked()

    fireEvent.click(screen.getByRole('radio', { name: 'Driving' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Walking' }))

    expect(screen.getByText('31m')).toBeInTheDocument()
    expect(screen.queryByText(/^About /)).toBeNull()
    expect(screen.queryByText(/Nothing has been re-planned/)).toBeNull()
  })

  // The route row is never mutated, so the flip must not write anywhere — and
  // the served payload it is reading has to come out the other side identical.
  it('writes nothing and leaves the stops and geometry alone', async () => {
    let wrote = false
    api.mock('PUT /v1/door-knocking/turfs/:id', () => {
      wrote = true
      return { status: 200, data: turf() }
    })
    api.mock('POST /v1/door-knocking/turfs/:id/knock', () => {
      wrote = true
      return {
        status: 200,
        data: { created: false, route: routePayload.route },
      }
    })
    await renderKnocked()
    const before = testQueryClient.getQueryData<DoorKnockingRoutePayload>([
      'door-knocking-route',
      1,
    ])

    fireEvent.click(screen.getByRole('radio', { name: 'Driving' }))

    const after = testQueryClient.getQueryData<DoorKnockingRoutePayload>([
      'door-knocking-route',
      1,
    ])
    expect(wrote).toBe(false)
    expect(after?.route).toEqual(before?.route)
    expect(after?.pathGeometry).toEqual(before?.pathGeometry)
    expect(after?.stops.map((stop) => stop.seq)).toEqual(
      before?.stops.map((stop) => stop.seq),
    )
  })

  // Nothing to flip before there is a bought route to flip against.
  it('offers no toggle on an unknocked list', () => {
    renderSheet({ listStats: listStats() })

    expect(screen.queryByRole('radio', { name: 'Driving' })).toBeNull()
    expect(screen.queryByText('Travel time for')).toBeNull()
  })
})

describe('TurfDetailsSheet edit', () => {
  beforeEach(() => {
    testQueryClient.clear()
    successSnackbar.mockClear()
    errorSnackbar.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  const openEditor = async () => {
    fireEvent.click(await screen.findByLabelText('Edit Elm St & 5th'))
    return screen.findByRole('textbox')
  }

  // gp-api's update asserts not-locked too — the endpoint also accepts geoPoly,
  // and the polygon is what the frozen route was computed from.
  it('offers edit only while the turf is unlocked', () => {
    renderSheet({ prop: { locked: true } })
    expect(screen.queryByLabelText('Edit Elm St & 5th')).toBeNull()
  })

  it('retires the affordance when the live row is locked but the prop is stale', async () => {
    renderSheet({ prop: { locked: false }, live: { locked: true } })

    await waitFor(() =>
      expect(screen.queryByLabelText('Edit Elm St & 5th')).toBeNull(),
    )
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
    fireEvent.click(screen.getByLabelText('Turf color #16a34a'))
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

  // Someone knocked it while the dialog was open: permanent, so the dialog
  // closes rather than leaving an enabled Save that can only 409 again.
  it('closes and explains out of band on a 409', async () => {
    api.mock('PUT /v1/door-knocking/turfs/:id', {
      status: 409,
      data: { message: 'frozen' },
    })
    renderSheet()

    const input = await openEditor()
    fireEvent.change(input, { target: { value: 'Oak Ave' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/already been knocked/),
        expect.anything(),
      ),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull(),
    )
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('keeps the dialog open on a generic failure', async () => {
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

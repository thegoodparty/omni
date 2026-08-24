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
  doorCount: null,
  peopleCount: null,
  loggedCount: null,
  completedAt: null,
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
  listStats = null,
  listStatsPending = false,
  unpreviewableKeys = [],
  onDeleted = vi.fn(),
  savedLists = [],
}: {
  prop?: Partial<DoorKnockingTurf>
  live?: Partial<DoorKnockingTurf>
  listStats?: PolygonStats | null
  listStatsPending?: boolean
  unpreviewableKeys?: string[]
  onDeleted?: () => void
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

// The archive seam. #1375 gave a list its own archivedAt while the outreach
// envelope already had one, and nothing joined them — so a walk could be
// shelved on one rail and still be live on the other. Both surfaces that offer
// the shelf now go through the one writer in turfLifecycle.ts, which writes the
// list and mirrors the envelope off it; these cover the drawer's half of that.
describe('TurfDetailsSheet archive', () => {
  beforeEach(() => {
    testQueryClient.clear()
    successSnackbar.mockClear()
    errorSnackbar.mockClear()
  })

  const doneSheet = () =>
    renderSheet({
      prop: { locked: true, completedAt: new Date('2026-08-20T00:00:00Z') },
    })

  const clickArchive = async (name: string) => {
    const button = await screen.findByRole('button', { name })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
  }

  const mockRoute = () =>
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })

  const mockUnreadableRoute = () =>
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 500,
      data: undefined as never,
    })

  const envelope = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 30,
      createdAt: '2026-08-10T00:00:00Z',
      outreachType: 'nativeDoorKnocking',
      name: 'Elm St & 5th',
      status: 'in_progress',
      doorKnockingRouteId: 5,
      ...overrides,
    }) as never

  // Same gate as the rail card, deliberately: gp-api applies the transition to
  // a knocked list, and a walk still in progress is not one a candidate should
  // be able to shelve from one surface and not the other.
  it('offers archive only once the walk is done', async () => {
    mockRoute()
    renderSheet({ prop: { locked: true } })

    expect(
      await screen.findByRole('heading', { name: 'Elm St & 5th' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Move to Archive/ })).toBeNull()
  })

  it('archives the list and the outreach row it is reported as', async () => {
    let turfBody: unknown
    let envelopeArchive: { id?: string; body?: unknown } = {}
    mockRoute()
    api.mock('POST /v1/door-knocking/turfs/:id/archive', ({ params, body }) => {
      turfBody = body
      expect(params.id).toBe('1')
      return {
        status: 200,
        data: turf({ locked: true, archivedAt: new Date() }),
      }
    })
    api.mock('GET /v1/outreach', {
      status: 200,
      // A second walk's envelope, so the match is on the route id rather than
      // on being the only door-knocking row in the campaign.
      data: [envelope({ id: 31, doorKnockingRouteId: 99 }), envelope()],
    })
    api.mock('PATCH /v1/outreach/:id/archive', ({ params, body }) => {
      envelopeArchive = { id: params.id, body }
      return { status: 200, data: { id: 30, archivedAt: new Date() } }
    })

    doneSheet()
    await clickArchive('Move to Archive')

    await waitFor(() => expect(envelopeArchive.id).toBe('30'))
    expect(turfBody).toEqual({ archived: true })
    expect(envelopeArchive.body).toEqual({ archived: true })
    expect(successSnackbar).toHaveBeenCalledWith('Moved to archive')
  })

  // Restore is the same call with the flag flipped, on both rows, so the two
  // cannot come back out of step either.
  it('restores both rows from one control', async () => {
    let turfBody: unknown
    let envelopeBody: unknown
    mockRoute()
    api.mock('POST /v1/door-knocking/turfs/:id/archive', ({ body }) => {
      turfBody = body
      return { status: 200, data: turf({ locked: true, archivedAt: null }) }
    })
    api.mock('GET /v1/outreach', {
      status: 200,
      data: [envelope({ archivedAt: '2026-08-15T00:00:00Z' })],
    })
    api.mock('PATCH /v1/outreach/:id/archive', ({ body }) => {
      envelopeBody = body
      return { status: 200, data: { id: 30, archivedAt: null } }
    })

    renderSheet({
      prop: {
        locked: true,
        completedAt: new Date('2026-08-20T00:00:00Z'),
        archivedAt: new Date('2026-08-22T00:00:00Z'),
      },
    })

    await clickArchive('Restore')

    await waitFor(() => expect(envelopeBody).toEqual({ archived: false }))
    expect(turfBody).toEqual({ archived: false })
    expect(successSnackbar).toHaveBeenCalledWith('Restored from archive')
  })

  // A Serve org knocks without a campaign, so it has no envelope at all and
  // the list endpoint answers 404. Nothing to mirror is not a failure.
  it('archives a list that has no outreach campaign behind it', async () => {
    mockRoute()
    api.mock('POST /v1/door-knocking/turfs/:id/archive', {
      status: 200,
      data: turf({ locked: true, archivedAt: new Date() }),
    })
    api.mock('GET /v1/outreach', { status: 404, data: undefined as never })

    doneSheet()
    await clickArchive('Move to Archive')

    await waitFor(() =>
      expect(successSnackbar).toHaveBeenCalledWith('Moved to archive'),
    )
    expect(errorSnackbar).not.toHaveBeenCalled()
  })

  // The route id is the join key, so a route that cannot be read leaves the
  // envelope unaddressable. The list still moves — it is the candidate's to
  // shelve, and it is written first — but the drawer cannot claim the history
  // row followed.
  it('reports the lag when the route the mirror joins on is unreadable', async () => {
    let envelopeLooked = false
    mockUnreadableRoute()
    api.mock('POST /v1/door-knocking/turfs/:id/archive', {
      status: 200,
      data: turf({ locked: true, archivedAt: new Date() }),
    })
    api.mock('GET /v1/outreach', () => {
      envelopeLooked = true
      return { status: 200, data: [envelope()] }
    })

    doneSheet()
    await clickArchive('Move to Archive')

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        'Moved to archive, but your outreach history has not caught up yet.',
      ),
    )
    // No route id to match on, so the lookup is never even attempted — the lag
    // is reported rather than guessed at.
    expect(envelopeLooked).toBe(false)
    expect(successSnackbar).not.toHaveBeenCalled()
  })

  // A 404 from the outreach list is "no campaign", and only that. Anything
  // else means we never learned whether an envelope exists, so it lands as a
  // lagging mirror rather than as a clean archive.
  it('does not call a failed envelope lookup a clean archive', async () => {
    mockRoute()
    api.mock('POST /v1/door-knocking/turfs/:id/archive', {
      status: 200,
      data: turf({ locked: true, archivedAt: new Date() }),
    })
    api.mock('GET /v1/outreach', { status: 500, data: undefined as never })

    doneSheet()
    await clickArchive('Move to Archive')

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        'Moved to archive, but your outreach history has not caught up yet.',
      ),
    )
    expect(successSnackbar).not.toHaveBeenCalled()
  })

  // Two writes, no transaction: the list IS shelved, and reporting a failed
  // archive would send someone to press it again against a list that already
  // moved. So the message is about the projection lagging, not about the act.
  it('says the history lagged when only the mirror fails', async () => {
    mockRoute()
    api.mock('POST /v1/door-knocking/turfs/:id/archive', {
      status: 200,
      data: turf({ locked: true, archivedAt: new Date() }),
    })
    api.mock('GET /v1/outreach', { status: 200, data: [envelope()] })
    api.mock('PATCH /v1/outreach/:id/archive', {
      status: 500,
      data: undefined as never,
    })

    doneSheet()
    await clickArchive('Move to Archive')

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        'Moved to archive, but your outreach history has not caught up yet.',
      ),
    )
    expect(successSnackbar).not.toHaveBeenCalled()
  })
})

describe('TurfDetailsSheet delete', () => {
  beforeEach(() => {
    testQueryClient.clear()
    successSnackbar.mockClear()
    errorSnackbar.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  // gp-api's `delete` no longer runs assertNotLocked — a knocked list is
  // tombstoned rather than refused — so the control is pressable at every
  // stage and the confirmation is the guard. The lock's remaining consequence
  // (the route and area are frozen, so the list can't be edited) is still
  // stated here beside the Edit control it does hide.
  it('keeps delete pressable on a locked turf, and still says what the lock costs', () => {
    renderSheet({ prop: { locked: true } })

    expect(screen.getByLabelText('Delete Elm St & 5th')).toBeEnabled()
    expect(screen.getByText(/already been knocked/)).toBeInTheDocument()
  })

  it('leaves delete pressable and unexplained while the turf is unlocked', () => {
    renderSheet()

    expect(screen.getByLabelText('Delete Elm St & 5th')).toBeEnabled()
    expect(screen.queryByText(/already been knocked/)).toBeNull()
  })

  // The prop is a snapshot taken when the row was clicked. It no longer gates
  // the trigger, but it still decides what the confirmation says is about to
  // happen — and the two deletes destroy very different amounts, so a turf
  // knocked since the row was clicked has to warn about the knocked one.
  it('warns about the live row rather than the snapshot when the prop is stale', async () => {
    renderSheet({ prop: { locked: false }, live: { locked: true } })

    await waitFor(() =>
      expect(screen.getByLabelText('Delete Elm St & 5th')).toBeEnabled(),
    )
    fireEvent.click(screen.getByLabelText('Delete Elm St & 5th'))

    expect(
      await screen.findByText(/The route you paid for/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/removed for good/)).toBeNull()
  })

  // Same rule as the header and Edit: this sheet can rename the list, so a
  // control that named it from the click-time snapshot would ask "Delete Elm
  // St & 5th?" about a list renamed to Riverside loop a moment earlier — and
  // the confirm dialog is the last thing read before something is destroyed.
  it('names the live list, not the snapshot, in the delete affordance', async () => {
    renderSheet({
      prop: { name: 'Elm St & 5th' },
      live: { name: 'Riverside loop' },
    })

    await waitFor(() =>
      expect(screen.getByLabelText('Delete Riverside loop')).toBeEnabled(),
    )
    expect(screen.queryByLabelText('Delete Elm St & 5th')).toBeNull()

    fireEvent.click(screen.getByLabelText('Delete Riverside loop'))
    expect(
      await screen.findByText('Delete Riverside loop?'),
    ).toBeInTheDocument()
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
  ageMix: [],
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

  // The bar is a picture of the value above it rather than a second claim, so
  // it is aria-hidden and holds no text — the only way to it is through the
  // card that owns it.
  const loggedBar = () =>
    screen
      .getByText('People logged')
      .parentElement?.querySelector<HTMLElement>('.bg-info') ?? null

  // One of three targets logged. The width and the printed percent come off
  // one expression, so this asserts they agree rather than that a bar exists.
  it('draws the logged bar at the percentage it prints', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: {
        ...routeWithDoors,
        stops: routeWithDoors.stops.map((stop) => ({
          ...stop,
          addresses: stop.addresses.map((address) => ({
            ...address,
            targets: address.targets.map((target) =>
              target.stopTargetId === 21
                ? { ...target, knockStatus: 'not_home' as const }
                : target,
            ),
          })),
        })),
      } satisfies DoorKnockingRoutePayload,
    })
    renderSheet({ prop: { locked: true }, listStats: listStats() })

    expect(await screen.findByText('1 of 3 · 33%')).toBeInTheDocument()
    expect(loggedBar()).toHaveStyle({ width: '33%' })
  })

  // Zero is a real answer here — a locked list nobody has started — so unlike
  // the audience breakdown's bars this one is not floored to a visible
  // sliver. A hairline would draw a door that was never knocked.
  it('draws the logged bar empty rather than as a sliver at zero', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routeWithDoors,
    })
    renderSheet({ prop: { locked: true }, listStats: listStats() })

    expect(await screen.findByText('0 of 3 · 0%')).toBeInTheDocument()
    expect(loggedBar()).toHaveStyle({ width: '0%' })
  })

  // An unlocked list has no route and reads "Not knocked yet". A 0% bar there
  // draws an untouched list as a walk barely begun — the bar hangs off the
  // route existing, not off the percentage, which is 0 in both cases.
  it('draws no logged bar on a list that was never knocked', () => {
    renderSheet({ listStats: listStats() })

    // Twice: route type and people logged, per the pack-loading test above.
    expect(screen.getAllByText('Not knocked yet')).toHaveLength(2)
    expect(loggedBar()).toBeNull()
  })

  // The same rule through the two states that also have no figure to draw.
  it('draws no logged bar while the route is loading', async () => {
    api.mock(
      'GET /v1/door-knocking/turfs/:id/route',
      () => new Promise(() => undefined),
    )
    renderSheet({ prop: { locked: true }, listStats: listStats() })

    await waitFor(() =>
      expect(screen.getAllByText('Loading').length).toBeGreaterThan(0),
    )
    expect(loggedBar()).toBeNull()
  })

  it('draws no logged bar when the route fails to load', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 500,
      data: { message: 'boom' },
    })
    renderSheet({ prop: { locked: true }, listStats: listStats() })

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
    expect(loggedBar()).toBeNull()
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

    // Doors, people, the knocking estimate — and the audience breakdown,
    // which is read off the same pack pass and must not settle before it.
    expect(screen.getAllByText('Loading')).toHaveLength(4)
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

  // Six numbers in a two-column grid, told apart by their labels alone. The
  // glyph is what makes the grid scannable, and it is decorative — the label
  // beside it already names the figure, so a screen reader must not meet it.
  it('marks each overview stat with the icon for its own quantity', () => {
    renderSheet({ listStats: listStats() })

    const doors = screen.getByText('Doors').closest('div')?.parentElement
    const icon = doors?.querySelector('svg')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
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
    expect(screen.getByText('Homeowner')).toBeInTheDocument()
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
    renderSheet({ prop: { locked: true } })

    // Waiting on a route-derived stat is what makes the absences below an
    // observation about the rendered sheet rather than a race with the fetch.
    expect(await screen.findByText(/Walk route/)).toBeInTheDocument()
    expect(screen.queryByText('105 Elm St Apt 1')).toBeNull()
    expect(screen.queryByText('Doors in this list')).toBeNull()
  })

  // The pack holds positions and demographic byte planes — no address and no
  // name at any price — so an unknocked list never had doors to list, and the
  // sheet used to say so at length under a "Doors in this list" heading. With
  // no roster on either branch there is no absence left to explain.
  it('explains nothing about addresses on an unknocked list', () => {
    renderSheet({ listStats: listStats() })

    expect(
      screen.queryByText(/Street addresses arrive with the route/),
    ).toBeNull()
    expect(screen.queryByText('Doors in this list')).toBeNull()
  })
})

describe('TurfDetailsSheet audience', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  // "Applied filters" says what was ASKED FOR; this says what the audience IS.
  // Pre-route it is the pack's, so it is the same superset the counts are, and
  // it sits directly under the two lines that disclose that.
  it('breaks the pack audience down by party and age', () => {
    renderSheet({
      listStats: listStats({
        partyMix: [
          { label: 'Democratic', people: 60 },
          { label: 'Republican', people: 40 },
        ],
        ageMix: [{ label: '35_50', people: 100 }],
      }),
    })

    expect(screen.getByText('Party')).toBeInTheDocument()
    expect(screen.getByText('Democratic')).toBeInTheDocument()
    expect(screen.getByText('60 · 60%')).toBeInTheDocument()
    // The pack ships raw bucket keys; the sheet is what turns them into prose.
    expect(screen.getByText('35–50')).toBeInTheDocument()
    expect(screen.queryByText('35_50')).toBeNull()
  })

  // The frozen route's targets are the audience, so its breakdown is built off
  // them rather than off the pack — and off the KNOCKABLE ones, so it sums to
  // the People stat above instead of quietly using a wider denominator.
  it('breaks a frozen route down from its own targets', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: {
        ...routeWithDoors,
        stops: [
          {
            ...routeWithDoors.stops[0]!,
            addresses: [
              {
                addressKey: '105|elm|st|1',
                address: '105 Elm St Apt 1',
                otherResidents: [],
                targets: [
                  {
                    ...resident,
                    stopTargetId: 21,
                    age: 40,
                    politicalParty: 'Democratic' as const,
                  },
                  {
                    ...resident,
                    stopTargetId: 22,
                    personId: 'person-2',
                    age: 70,
                    politicalParty: 'Democratic' as const,
                    // Flagged, so out of the breakdown as well as the count.
                    doNotKnock: true,
                  },
                ],
              },
            ],
          },
        ],
      } satisfies DoorKnockingRoutePayload,
    })
    renderSheet({ prop: { locked: true }, listStats: listStats() })

    expect(await screen.findByText('31m')).toBeInTheDocument()
    // One knockable Democrat aged 40 — the 50+ do-not-knock resident is not in
    // the audience the People stat reports, so they are not in its breakdown.
    // Both dims report the same lone person, hence two identical figures.
    expect(screen.getAllByText('1 · 100%')).toHaveLength(2)
    expect(screen.getByText('Democratic')).toBeInTheDocument()
    expect(screen.getByText('35–50')).toBeInTheDocument()
    expect(screen.queryByText('50+')).toBeNull()
    // The pack's own mix must not leak through once a route exists.
    expect(screen.queryByText('Republican')).toBeNull()
  })

  // Every slice here holds at least one person, because both sources drop
  // empty buckets — so a lone person in a large list rounds to zero and the
  // row contradicts itself. "1 · 0%" beside an invisible bar reads as broken
  // rendering rather than as a small number.
  it('floors a sub-one-percent slice instead of printing zero', () => {
    renderSheet({
      listStats: listStats({
        partyMix: [
          { label: 'Democratic', people: 400 },
          { label: 'Republican', people: 1 },
        ],
      }),
    })

    expect(screen.getByText('1 · <1%')).toBeInTheDocument()
    expect(screen.queryByText('1 · 0%')).toBeNull()
  })

  // The mix is built from `knockableTargets`, so a locked list whose every
  // resident is flagged empties it — which is not the same claim as a list
  // with nobody in it, and saying "yet" to someone holding a walked list
  // reads as the sheet having lost their route.
  it('says why a fully flagged route has no audience, without saying yet', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: {
        ...routeWithDoors,
        stops: [
          {
            ...routeWithDoors.stops[0]!,
            addresses: [
              {
                addressKey: '105|elm|st|1',
                address: '105 Elm St Apt 1',
                otherResidents: [],
                targets: [{ ...resident, stopTargetId: 21, doNotKnock: true }],
              },
            ],
          },
        ],
      } satisfies DoorKnockingRoutePayload,
    })
    renderSheet({ prop: { locked: true } })

    expect(
      await screen.findByText(/no audience left to break down/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/No one to describe in this list yet/)).toBeNull()
  })

  // Settled with nothing is a different claim from still loading, and 'no bars'
  // must not be the rendering of either.
  it('does not render an empty breakdown when the audience is unavailable', () => {
    renderSheet({ listStats: null, listStatsPending: false })

    expect(screen.getByText(/No breakdown to show/)).toBeInTheDocument()
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

  // The affordance moved into the shared footer's primary slot, where it is the
  // canvas's `edit` mode. It no longer carries an aria-label naming the list —
  // one full-width button under one list's overview, so "Edit list" is already
  // unambiguous, and an aria-label that didn't contain the visible text would
  // break label-in-name.
  const openEditor = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Edit list' }))
    return screen.findByRole('textbox')
  }

  // gp-api's update asserts not-locked too — the endpoint also accepts geoPoly,
  // and the polygon is what the frozen route was computed from.
  it('offers edit only while the turf is unlocked', () => {
    renderSheet({ prop: { locked: true } })
    expect(screen.queryByRole('button', { name: 'Edit list' })).toBeNull()
  })

  it('retires the affordance when the live row is locked but the prop is stale', async () => {
    renderSheet({ prop: { locked: false }, live: { locked: true } })

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Edit list' })).toBeNull(),
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

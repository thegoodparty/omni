import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import VolunteerWalkPage from './VolunteerWalkPage'

// useWalkCompletion reaches useTurfLifecycle, which reports through
// useSnackbar and throws outside its provider — same reason
// NativeDoorKnockingPage.test.tsx and WalkView.test.tsx stub it.
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))
vi.mocked(useSnackbar).mockReturnValue({
  successSnackbar: vi.fn(),
  errorSnackbar: vi.fn(),
} as unknown as ReturnType<typeof useSnackbar>)

// deck.gl and maplibre don't run in jsdom — same stub shape
// NativeDoorKnockingPage.test.tsx uses, pared to what this page reads.
vi.mock('app/dashboard/door-knocking/native/VoterMapCanvas', () => ({
  __esModule: true,
  default: ({
    pack,
    filterResult,
    routePins,
  }: {
    pack: unknown
    filterResult: unknown
    routePins: Array<{ stopId: number }>
  }) => (
    <div
      data-testid="voter-map"
      // The volunteer walk's whole point: no district pack behind the route.
      data-pack={String(pack === null)}
      data-filter-result={String(filterResult === null)}
      data-pins={routePins.map((pin) => pin.stopId).join(',')}
    />
  ),
}))

const turf: DoorKnockingTurf = {
  id: 7,
  voterFileFilterId: 3,
  name: 'Elm St & 5th',
  color: '#2563eb',
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
  doorCount: 2,
  peopleCount: 2,
  loggedCount: 0,
  knockedDoorCount: 0,
  routeSeconds: 600,
  completed: false,
  archivedAt: null,
  createdAt: new Date('2026-07-21T00:00:00Z'),
  updatedAt: new Date('2026-07-21T00:00:00Z'),
}

const routePayload = {
  route: {
    id: 5,
    doorKnockingTurfId: 7,
    mode: 'walk' as const,
    loop: false,
    totalSeconds: 600,
    totalMeters: 800,
    stopCount: 1,
    createdAt: new Date('2026-07-21T00:00:00Z'),
  },
  pathGeometry: null,
  stops: [
    {
      id: 11,
      seq: 1,
      lat: 41.92,
      lng: -87.66,
      displayAddress: '105 Elm St',
      legSeconds: 0,
      legMeters: 0,
      addresses: [
        {
          addressKey: '105|elm|st',
          address: '105 Elm St',
          unit: '',
          otherResidents: [],
          targets: [
            {
              stopTargetId: 21,
              personId: 'person-21',
              name: 'Dorian Fen',
              age: 40,
              politicalParty: null,
              cellPhone: null,
              landline: null,
              knockStatus: 'unknown' as const,
              mayHaveMoved: false,
              doNotKnock: false,
            },
          ],
        },
      ],
    },
  ],
}

let packRequested = false

beforeEach(() => {
  testQueryClient.clear()
  vi.clearAllMocks()
  packRequested = false
  // Registered on every test so a regression that reintroduces a pack read is
  // caught here rather than merely making the page hang — GET /v1/door-knocking
  // /pack stays 403 for a volunteer server-side, and the point of this
  // component is that it never asks.
  api.mock('GET /v1/door-knocking/pack', () => {
    packRequested = true
    return { status: 403, data: new ArrayBuffer(0) }
  })
})

describe('VolunteerWalkPage', () => {
  it('renders the stop list from the served route with no pack behind it', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id', { status: 200, data: turf })
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })

    render(<VolunteerWalkPage turfId={7} />)

    expect(await screen.findByText('105 Elm St')).toBeInTheDocument()
    expect(screen.getByText('Elm St & 5th')).toBeInTheDocument()

    // Dynamically imported (`next/dynamic(..., { ssr: false })`), so even a
    // mocked module resolves on a later tick than the rest of the tree.
    const map = await screen.findByTestId('voter-map')
    expect(map).toHaveAttribute('data-pack', 'true')
    expect(map).toHaveAttribute('data-filter-result', 'true')
    await waitFor(() => expect(map).toHaveAttribute('data-pins', '11'))
    expect(packRequested).toBe(false)
  })

  it('returns to /volunteer on exit', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id', { status: 200, data: turf })
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })

    render(<VolunteerWalkPage turfId={7} />)

    await screen.findByText('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(router.push).toHaveBeenCalledWith('/volunteer')
  })

  it('shows a retry error card on a server error, and actually refetches on Try again', async () => {
    let turfCalls = 0
    let routeCalls = 0
    api.mock('GET /v1/door-knocking/turfs/:id', () => {
      turfCalls += 1
      return { status: 500, data: { message: 'upstream error' } }
    })
    api.mock('GET /v1/door-knocking/turfs/:id/route', () => {
      routeCalls += 1
      return { status: 500, data: { message: 'upstream error' } }
    })

    render(<VolunteerWalkPage turfId={7} />)

    expect(
      await screen.findByText('Couldn’t load this route'),
    ).toBeInTheDocument()
    // A 500 is not a revocation — the two cards must not be conflatable.
    expect(
      screen.queryByText('You’re no longer assigned to this route'),
    ).toBeNull()

    await waitFor(() => expect(turfCalls).toBeGreaterThan(0))
    await waitFor(() => expect(routeCalls).toBeGreaterThan(0))
    const turfCallsBeforeRetry = turfCalls
    const routeCallsBeforeRetry = routeCalls

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    // The observable effect of the retry, not merely that the button's own
    // handler ran: both endpoints actually go back over the wire.
    await waitFor(() => {
      expect(turfCalls).toBeGreaterThan(turfCallsBeforeRetry)
      expect(routeCalls).toBeGreaterThan(routeCallsBeforeRetry)
    })
  })

  it('shows a not-assigned card when the turf is no longer this volunteer’s', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id', {
      status: 404,
      data: { message: 'Not found' },
    })
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })

    render(<VolunteerWalkPage turfId={7} />)

    expect(
      await screen.findByText('You’re no longer assigned to this route'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to your assignments' }),
    ).toHaveAttribute('href', '/volunteer')
    expect(packRequested).toBe(false)
  })

  it('shows a not-assigned card when the route itself is revoked', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id', { status: 200, data: turf })
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 404,
      data: { message: 'Not found' },
    })

    render(<VolunteerWalkPage turfId={7} />)

    expect(
      await screen.findByText('You’re no longer assigned to this route'),
    ).toBeInTheDocument()
  })
})

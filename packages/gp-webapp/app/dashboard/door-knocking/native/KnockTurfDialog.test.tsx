import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import KnockTurfDialog from './KnockTurfDialog'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const turf: DoorKnockingTurf = {
  id: 3,
  voterFileFilterId: 7,
  name: 'Elm loop',
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
}

// ~100m apart at this latitude (0.0009° of latitude is about 100m), so every
// leg is well inside the five-minute walk the suggestion asks about.
const CLUSTERED_STOPS: Array<[number, number]> = [
  [-86.78, 36.16],
  [-86.78, 36.1609],
  [-86.78, 36.1618],
]
// ~1.1km between the two halves: no visit order can avoid that leg, so the
// whole list is a drive list.
const SPREAD_STOPS: Array<[number, number]> = [
  [-86.78, 36.16],
  [-86.78, 36.1609],
  [-86.78, 36.171],
  [-86.78, 36.1719],
]

describe('KnockTurfDialog', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.mocked(trackEvent).mockClear()
  })

  it('posts the chosen mode and loop and hands off to the route', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/turfs/:id/knock', ({ body, params }) => {
      posted.push({ ...body, id: params.id })
      return {
        status: 200,
        data: {
          created: true,
          route: {
            id: 5,
            doorKnockingTurfId: 3,
            mode: 'drive',
            loop: false,
            totalSeconds: 900,
            totalMeters: 4000,
            stopCount: 40,
            createdAt: new Date('2026-07-21T00:00:00Z'),
          },
        },
      }
    })
    const onRouteReady = vi.fn()

    render(
      <KnockTurfDialog
        turf={turf}
        stops={null}
        open={true}
        onOpenChange={vi.fn()}
        onRouteReady={onRouteReady}
      />,
    )

    fireEvent.click(screen.getByLabelText(/Driving/))
    fireEvent.click(screen.getByLabelText(/End where I start/))
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    await waitFor(() => expect(onRouteReady).toHaveBeenCalledWith(3))
    expect(posted).toEqual([{ id: '3', mode: 'drive', loop: false }])
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.RouteBuilt, {
      turfId: 3,
      mode: 'drive',
      loop: false,
      stopCount: 40,
      suggestedMode: null,
      created: true,
    })
  })

  // A 429 (daily routing budget) and a 502 (vendor down) are different
  // problems, and the status is the only thing that tells them apart.
  it('reports the status a failed route build came back with', async () => {
    api.mock('POST /v1/door-knocking/turfs/:id/knock', {
      status: 429,
      data: { message: 'out of stops' },
    })

    render(
      <KnockTurfDialog
        turf={turf}
        stops={null}
        open={true}
        onOpenChange={vi.fn()}
        onRouteReady={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.DoorKnocking.RouteBuildFailed,
        { turfId: 3, mode: 'walk', loop: true, status: 429 },
      ),
    )
    expect(
      vi
        .mocked(trackEvent)
        .mock.calls.filter(([name]) => name === EVENTS.DoorKnocking.RouteBuilt),
    ).toHaveLength(0)
  })

  const buildAndReadError = async () => {
    const onRouteReady = vi.fn()
    render(
      <KnockTurfDialog
        turf={turf}
        stops={null}
        open={true}
        onOpenChange={vi.fn()}
        onRouteReady={onRouteReady}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))
    const alert = await screen.findByRole('alert')
    expect(onRouteReady).not.toHaveBeenCalled()
    return alert
  }

  // A server outage is the one case where waiting is genuinely the fix, so
  // it keeps the generic copy.
  it('shows the generic retry message when the server fails', async () => {
    api.mock('POST /v1/door-knocking/turfs/:id/knock', {
      status: 500,
      data: { message: 'Internal server error' },
    })

    expect(await buildAndReadError()).toHaveTextContent(
      /Route building failed — nothing was saved/,
    )
  })

  // Waiting a moment does nothing for a spent daily budget or a turf with no
  // voters in it — gp-api says exactly what to do instead, so say that.
  it('surfaces the reason a 4xx gives instead of telling the user to retry', async () => {
    api.mock('POST /v1/door-knocking/turfs/:id/knock', {
      status: 429,
      data: {
        message:
          'This route needs 40 stops and only 12 of your 500 daily stops are left.',
      },
    })

    const alert = await buildAndReadError()
    expect(alert).toHaveTextContent(/only 12 of your 500 daily stops/)
    expect(alert).not.toHaveTextContent(/Try again in a moment/)
  })

  // A 4xx with an unreadable body still has to say something.
  it('falls back to the generic message when a 4xx carries no message', async () => {
    api.mock('POST /v1/door-knocking/turfs/:id/knock', {
      status: 400,
      data: {},
    })

    expect(await buildAndReadError()).toHaveTextContent(
      /Route building failed — nothing was saved/,
    )
  })
})

// The mode is permanent the moment the route is bought — the row is never
// rewritten and the path we buy is mode-specific — so the choice was previously
// a guess made at the one moment it stops being changeable. Suggesting from the
// stops' own spread is what makes the default usually right.
describe('KnockTurfDialog travel mode suggestion', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.mocked(trackEvent).mockClear()
  })

  const renderDialog = (stops: Array<[number, number]> | null) => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/turfs/:id/knock', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: {
          created: true,
          route: {
            id: 5,
            doorKnockingTurfId: 3,
            mode: 'walk',
            loop: true,
            totalSeconds: 900,
            totalMeters: 4000,
            stopCount: 3,
            createdAt: new Date('2026-07-21T00:00:00Z'),
          },
        },
      }
    })
    render(
      <KnockTurfDialog
        turf={turf}
        stops={stops}
        open={true}
        onOpenChange={vi.fn()}
        onRouteReady={vi.fn()}
      />,
    )
    return posted
  }

  it('preselects walking for a tightly clustered list', () => {
    renderDialog(CLUSTERED_STOPS)

    expect(screen.getByLabelText(/Walking/)).toBeChecked()
    expect(screen.getByLabelText(/Driving/)).not.toBeChecked()
    expect(screen.getByText('Suggested').closest('label')).toHaveTextContent(
      'Walking',
    )
    expect(
      screen.getByText(/every stop is within a 5-minute walk/),
    ).toBeInTheDocument()
  })

  // One long leg makes the whole list a drive list — the prototype's rule, and
  // no mixing: one mode buys one route.
  it('preselects driving for a spread-out list', () => {
    renderDialog(SPREAD_STOPS)

    expect(screen.getByLabelText(/Driving/)).toBeChecked()
    expect(screen.getByLabelText(/Walking/)).not.toBeChecked()
    expect(screen.getByText('Suggested').closest('label')).toHaveTextContent(
      'Driving',
    )
    expect(
      screen.getByText(/more than a 5-minute walk from the rest/),
    ).toBeInTheDocument()
  })

  // A suggestion, not a verdict: the candidate knows things the geometry
  // doesn't, and this is their last chance to say so.
  it('posts the override rather than the suggestion', async () => {
    const posted = renderDialog(SPREAD_STOPS)

    fireEvent.click(screen.getByLabelText(/Walking/))
    expect(screen.getByLabelText(/Walking/)).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    await waitFor(() => expect(posted).toEqual([{ mode: 'walk', loop: true }]))
    // Both, so the override is legible as one rather than looking like the
    // default it overruled.
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.DoorKnocking.RouteBuilt,
      expect.objectContaining({ mode: 'walk', suggestedMode: 'drive' }),
    )
  })

  // The pack decodes on its own schedule, so there is a window with no stops to
  // read. Walking stays the standing default there, unmarked — a "Suggested"
  // tag on a suggestion nothing was derived from is the guess this replaces.
  it('makes no claim before the stops are known', () => {
    renderDialog(null)

    expect(screen.getByLabelText(/Walking/)).toBeChecked()
    expect(screen.queryByText('Suggested')).toBeNull()
    expect(screen.queryByText(/5-minute walk/)).toBeNull()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import KnockTurfDialog from './KnockTurfDialog'

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
  createdAt: new Date('2026-07-21T00:00:00Z'),
  updatedAt: new Date('2026-07-21T00:00:00Z'),
}

describe('KnockTurfDialog', () => {
  beforeEach(() => {
    testQueryClient.clear()
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
  })

  const buildAndReadError = async () => {
    const onRouteReady = vi.fn()
    render(
      <KnockTurfDialog
        turf={turf}
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

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
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import TurfList from './TurfList'

const turf = (overrides: Partial<DoorKnockingTurf>): DoorKnockingTurf => ({
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

describe('TurfList', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  it('focuses a turf on click and locks knocked turfs against deletion', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({ id: 1, name: 'Elm St & 5th' }),
        turf({ id: 2, name: 'Riverside loop', locked: true }),
      ],
    })
    const onFocusTurf = vi.fn()
    const onKnockTurf = vi.fn()
    const onOpenRoute = vi.fn()

    render(
      <TurfList
        onFocusTurf={onFocusTurf}
        onKnockTurf={onKnockTurf}
        onOpenRoute={onOpenRoute}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Elm St & 5th')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('Elm St & 5th'))
    expect(onFocusTurf).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: 'Elm St & 5th' }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Knock' }))
    expect(onKnockTurf).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))

    fireEvent.click(screen.getByRole('button', { name: 'Route' }))
    expect(onOpenRoute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, name: 'Riverside loop' }),
    )
    expect(
      screen.queryByRole('button', { name: 'Delete turf Riverside loop' }),
    ).toBeNull()
  })

  it('treats the turf being walked as locked before the refetch settles', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 1, name: 'Elm St & 5th', locked: false })],
    })

    render(
      <TurfList
        walkingTurfId={1}
        onFocusTurf={vi.fn()}
        onKnockTurf={vi.fn()}
        onOpenRoute={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Elm St & 5th')).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: 'Knock' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Route' })).toBeInTheDocument()
  })

  it('deletes an unlocked turf and refetches the list', async () => {
    let deleted = false
    api.mock('GET /v1/door-knocking/turfs', () => ({
      status: 200,
      data: deleted ? [] : [turf({ id: 1, name: 'Elm St & 5th' })],
    }))
    api.mock('DELETE /v1/door-knocking/turfs/:id', ({ params }) => {
      expect(params.id).toBe('1')
      deleted = true
      return { status: 200, data: undefined }
    })

    render(
      <TurfList
        onFocusTurf={vi.fn()}
        onKnockTurf={vi.fn()}
        onOpenRoute={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Elm St & 5th')).toBeInTheDocument(),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete turf Elm St & 5th' }),
    )
    await waitFor(() => expect(screen.queryByText('Elm St & 5th')).toBeNull())
  })
})

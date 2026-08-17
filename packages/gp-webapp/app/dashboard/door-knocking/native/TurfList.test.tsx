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

  it('always offers Details and Knock, locked or not', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({ id: 1, name: 'Elm St & 5th' }),
        turf({ id: 2, name: 'Riverside loop', locked: true }),
      ],
    })
    const onFocusTurf = vi.fn()
    const onShowDetails = vi.fn()
    const onKnockTurf = vi.fn()

    render(
      <TurfList
        selectedTurfId={null}
        onFocusTurf={onFocusTurf}
        onShowDetails={onShowDetails}
        onKnockTurf={onKnockTurf}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Saved lists · 2')).toBeInTheDocument(),
    )
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Knock' })).toHaveLength(2)
    // No route/delete affordances on the card.
    expect(screen.queryByRole('button', { name: 'Route' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()

    fireEvent.click(screen.getByText('Elm St & 5th'))
    expect(onFocusTurf).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))

    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]!)
    expect(onShowDetails).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Knock' })[1]!)
    expect(onKnockTurf).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, locked: true }),
    )
  })

  // The walk list on paper used to be reachable only from inside a walk, which
  // meant finding it required already having done the thing you wanted paper
  // for. Only a locked list has a route to put on paper.
  it('offers the PDF on a locked list and not on an unknocked one', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({ id: 1, name: 'Elm St & 5th' }),
        turf({ id: 2, name: 'Riverside loop', locked: true }),
      ],
    })

    render(
      <TurfList
        selectedTurfId={null}
        onFocusTurf={vi.fn()}
        onShowDetails={vi.fn()}
        onKnockTurf={vi.fn()}
      />,
    )

    const link = await screen.findByRole('link', { name: 'PDF' })
    expect(link).toHaveAttribute('href', '/dashboard/door-knocking/print/2/pdf')
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})

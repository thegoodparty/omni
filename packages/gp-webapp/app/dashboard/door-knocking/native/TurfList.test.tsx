import { ComponentProps } from 'react'
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

const renderList = (props: Partial<ComponentProps<typeof TurfList>> = {}) =>
  render(
    <TurfList
      selectedTurfId={null}
      hiddenTurfIds={new Set()}
      onFocusTurf={vi.fn()}
      onToggleTurfVisibility={vi.fn()}
      onShowDetails={vi.fn()}
      onKnockTurf={vi.fn()}
      {...props}
    />,
  )

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

    renderList({ onFocusTurf, onShowDetails, onKnockTurf })

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

  // The literal first screen a new candidate sees. Rendering nothing left the
  // rail with a heading, status chips and no account of what a list is.
  it('explains how to get a list when there are none', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })

    renderList()

    expect(await screen.findByText(/No lists yet/)).toBeInTheDocument()
    expect(screen.getByText('Saved lists')).toBeInTheDocument()
  })

  it('shows a placeholder while the lists load', () => {
    // Never settles, so the rail stays in its pending state.
    api.mock('GET /v1/door-knocking/turfs', () => new Promise(() => undefined))

    renderList()

    expect(screen.getByText('Loading your saved lists')).toBeInTheDocument()
    // "No lists yet" during the fetch is a guess about an account we haven't
    // read yet.
    expect(screen.queryByText(/No lists yet/)).toBeNull()
  })

  // A failed fetch is not an empty account, and the page explains a map that
  // could not load — so this stays quiet rather than doubling up on it.
  it('stays out of the way when the fetch fails', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 500,
      data: { message: 'boom' },
    })

    const { container } = renderList()

    await waitFor(() => expect(container).toBeEmptyDOMElement())
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

    renderList()

    const link = await screen.findByRole('link', { name: 'PDF' })
    expect(link).toHaveAttribute('href', '/dashboard/door-knocking/print/2/pdf')
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  // Every ring rendered at once and always, so a dozen lists were a dozen
  // overlapping outlines with no way to quiet any of them.
  it('offers a per-row visibility toggle naming its own list', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({ id: 1, name: 'Elm St & 5th' }),
        turf({ id: 2, name: 'Riverside loop' }),
      ],
    })
    const onToggleTurfVisibility = vi.fn()

    renderList({ hiddenTurfIds: new Set([2]), onToggleTurfVisibility })

    // Named per list, so a rail of these isn't a column of identical buttons.
    const hide = await screen.findByRole('button', {
      name: 'Hide Elm St & 5th on the map',
    })
    const show = screen.getByRole('button', {
      name: 'Show Riverside loop on the map',
    })
    expect(hide).toHaveAttribute('aria-pressed', 'false')
    expect(show).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(hide)
    expect(onToggleTurfVisibility).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    )
  })

  // Hiding quiets an outline; it does not archive a list. The row keeps every
  // affordance so a hidden list is still one Knock away.
  it('keeps Details, PDF and Knock on a hidden list', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 2, name: 'Riverside loop', locked: true })],
    })

    renderList({ hiddenTurfIds: new Set([2]) })

    expect(
      await screen.findByRole('button', { name: 'Details' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Knock' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'PDF' })).toBeInTheDocument()
  })
})

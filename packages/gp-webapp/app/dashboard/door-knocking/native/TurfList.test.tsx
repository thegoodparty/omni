import { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import TurfList from './TurfList'

// The test renderer wraps only QueryClientProvider, and the row's delete
// control reports through useSnackbar, which throws outside its provider.
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))
const successSnackbar = vi.fn()
const errorSnackbar = vi.fn()
vi.mocked(useSnackbar).mockReturnValue({
  successSnackbar,
  errorSnackbar,
} as unknown as ReturnType<typeof useSnackbar>)

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
  doorCount: null,
  peopleCount: null,
  loggedCount: null,
  completedAt: null,
  archivedAt: null,
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
      onDeletedTurf={vi.fn()}
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
    expect(screen.queryByRole('button', { name: 'Route' })).toBeNull()

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

  // The row carries the numbers gp-api derived from the frozen route. It does
  // not compute them: the details sheet one tap away derives its own from the
  // route payload, and a rail that disagreed with it would be worse than a
  // rail with no numbers on it at all.
  it('prints doors and the logged pair on a knocked list', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({
          id: 2,
          name: 'Riverside loop',
          locked: true,
          doorCount: 24,
          peopleCount: 31,
          loggedCount: 8,
        }),
      ],
    })

    renderList()

    // Two figures, not one ratio: doors and people are different
    // populations, and the logged pair is people over people — the same
    // quantity the details sheet labels "People logged".
    expect(await screen.findByText(/24 doors/)).toBeInTheDocument()
    expect(screen.getByText(/8 of 31/)).toBeInTheDocument()
    // Never the prototype's people-over-doors pairing.
    expect(screen.queryByText(/8 of 24/)).toBeNull()
    expect(screen.queryByText(/knocked/i)).toBeNull()
    // The word is "logged": not-home, inaccessible and refused all count
    // toward it, and none of them is a conversation.
    expect(screen.queryByText(/reached/i)).toBeNull()
  })

  // An unlocked list has no route, so there is nothing to count — and a zero
  // would claim a list somebody walked and found empty.
  it('shows no numbers on a list that has never been knocked', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 1, name: 'Elm St & 5th' })],
    })

    renderList()

    expect(await screen.findByText('Elm St & 5th')).toBeInTheDocument()
    expect(screen.queryByText(/doors/)).toBeNull()
    expect(screen.queryByText(/logged/)).toBeNull()
    expect(screen.queryByText(/^0 /)).toBeNull()
  })

  // "8 of 31 logged" leaves its noun to the visible column layout, which a
  // screen reader has none of — and the three numbers on this surface are
  // exactly the ones that must never be confused for each other.
  it('names the population for a screen reader', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({
          id: 2,
          locked: true,
          doorCount: 1,
          peopleCount: 3,
          loggedCount: 2,
        }),
      ],
    })

    renderList()

    // The visible line reads "1 door · 2 of 3 logged"; the noun is only in
    // the full text content, which is what a screen reader announces.
    expect(await screen.findByText(/1 door ·/)).toHaveTextContent(
      '1 door · 2 of 3 people logged',
    )
  })

  // Tapping the name is what scopes the map, the count line and the legend to
  // one list, and it is the only affordance on the row without a label saying
  // so — a name between two buttons reads as a caption rather than a target.
  it('says what tapping a list does', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 1, name: 'Elm St & 5th' })],
    })

    renderList()

    expect(
      await screen.findByText(/Tap a list to highlight it on the map/),
    ).toBeInTheDocument()
  })

  // The hint is about rows, so it belongs to the branch that has some: the
  // empty state already explains how to make a first list, and telling someone
  // with no lists to tap one is instructions for a screen they aren't on.
  it('keeps the tap hint off the empty state', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })

    renderList()

    expect(await screen.findByText(/No lists yet/)).toBeInTheDocument()
    expect(screen.queryByText(/Tap a list to highlight/)).toBeNull()
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

  // The rail is where a candidate compares lists, so per-list controls belong
  // on the row. Delete used to live only inside the details sheet, which is
  // two clicks from the row it acts on and covers that row while it is open —
  // and the walkthrough reported the feature as missing entirely.
  it('offers delete on the row, named for its own list', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({ id: 1, name: 'Elm St & 5th' }),
        turf({ id: 2, name: 'Riverside loop' }),
      ],
    })

    renderList()

    // Named per list rather than a column of identical trash icons — and a
    // different name from the details sheet's own trigger, which is mounted at
    // the same time on the page.
    expect(
      await screen.findByRole('button', { name: 'Delete Elm St & 5th list' }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Delete Riverside loop list' }),
    ).toBeEnabled()
  })

  // gp-api's assertNotLocked 409s a knocked turf, so this can't be pressable.
  // It renders anyway: an affordance that deletes itself for the lists a
  // candidate has actually walked is indistinguishable from one that was never
  // built, which is exactly how it got reported.
  it('shows delete disabled rather than absent on a knocked list', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 2, name: 'Riverside loop', locked: true })],
    })

    renderList()

    expect(
      await screen.findByRole('button', { name: 'Delete Riverside loop list' }),
    ).toBeDisabled()
  })

  it('deletes from the row after confirmation and tells the page', async () => {
    let deletedId: string | undefined
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 1, name: 'Elm St & 5th' })],
    })
    api.mock('DELETE /v1/door-knocking/turfs/:id', ({ params }) => {
      deletedId = params.id
      return { status: 200, data: undefined }
    })
    const onDeletedTurf = vi.fn()

    renderList({ onDeletedTurf })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete Elm St & 5th list' }),
    )
    // The confirm lives in the dialog, so the row's trigger alone must not
    // delete a list out from under someone who brushed a trash icon.
    expect(deletedId).toBeUndefined()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deletedId).toBe('1'))
    expect(onDeletedTurf).toHaveBeenCalledWith(
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

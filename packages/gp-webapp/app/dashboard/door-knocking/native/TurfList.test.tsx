import { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

// Enough of a decoded pack for the rail to call it decoded — the empty card
// only asks whether one is in the cache, never what is in it.
const pack = {
  manifest: {
    version: 1,
    generatedAt: '2026-08-20T12:00:00Z',
    counts: { people: 4, households: 3, dots: 2 },
    dims: [{ key: 'party', values: ['Unknown', 'Democratic', 'Republican'] }],
    arrays: [],
  },
  positions: new Float32Array([-87.65, 41.9, -87.66, 41.91]),
  personToHousehold: new Uint32Array([0, 0, 1, 2]),
  householdToDot: new Uint32Array([0, 0, 1]),
  dimPlanes: new Map([['party', new Uint8Array([1, 1, 1, 2])]]),
}

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
      expect(screen.getByText('Saved lists (2)')).toBeInTheDocument(),
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
  it('prints the two populations as meta figures, each naming its own noun', async () => {
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

    // The canvas's two figures, in its order: doors and people are different
    // populations, so they are two items rather than one ratio.
    expect(await screen.findByText('24')).toHaveTextContent('24 doors')
    expect(screen.getByText('31')).toHaveTextContent('31 people')
  })

  // The canvas leads the card with its progress figure as an uppercase overline
  // above the name, and that placement is the point — it is the first thing
  // read on a rail a candidate scans to pick tonight's list.
  it('leads the card with the progress figure, above the name', async () => {
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

    // People over people, never the canvas's people-over-doors pairing: the
    // numerator is `loggedCount`, which counts people, so a `doorCount`
    // denominator would break the stops/doors/people rule in one sentence.
    const overline = await screen.findByText(/8 \/ 31 people logged/)
    expect(overline).toBeInTheDocument()
    expect(screen.queryByText(/8 \/ 24/)).toBeNull()

    // Above the name, not below it — `compareDocumentPosition` rather than a
    // class assertion, because the ordering is the behaviour.
    const name = screen.getByRole('button', { name: 'Riverside loop' })
    expect(
      overline.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    // The word is "logged": not-home, inaccessible and refused all count
    // toward it, and none of them is a conversation.
    expect(screen.queryByText(/reached/i)).toBeNull()
    expect(screen.queryByText(/doors knocked/i)).toBeNull()
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

  // A meta figure is a numeral beside an icon, so its noun exists only for a
  // screen reader — and the numbers on this surface are exactly the ones that
  // must never be confused for each other.
  it('names the population for a screen reader', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({
          id: 2,
          locked: true,
          doorCount: 1,
          peopleCount: 1,
          loggedCount: 1,
        }),
      ],
    })

    renderList()

    // Singular on one, because "1 doors" reads as a bug in the count. Both
    // figures read "1", so they are matched together and their nouns compared.
    await screen.findByRole('button', { name: 'Elm St & 5th' })
    expect(screen.getAllByText('1').map((node) => node.textContent)).toEqual([
      '1 door',
      '1 person',
    ])
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

  // The card describes the one thing there is to do on this screen, so the
  // control belongs in it — pointing at a button elsewhere on the page was the
  // next version of having no explanation at all.
  it('offers Create list from inside the empty card', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })
    testQueryClient.setQueryData(['door-knocking-pack'], pack)
    const onCreateList = vi.fn()

    renderList({ onCreateList })

    const create = await screen.findByRole('button', { name: 'Create list' })
    expect(create).toBeEnabled()
    // The card no longer sends anyone looking for a button somewhere else.
    expect(screen.queryByText(/Create list.*above/)).toBeNull()

    fireEvent.click(create)
    expect(onCreateList).toHaveBeenCalledTimes(1)
  })

  // The same expression the page header's Create list button is disabled on,
  // read off the same query. The two open the same flow, and the flow's who
  // step reports "No matching households" without a pack — so a card that let
  // you in early would tell a brand-new candidate their district is empty.
  it('keeps the empty card’s Create list disabled until the pack decodes', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })
    const onCreateList = vi.fn()

    renderList({ onCreateList })

    const create = await screen.findByRole('button', { name: 'Create list' })
    expect(create).toBeDisabled()

    fireEvent.click(create)
    expect(onCreateList).not.toHaveBeenCalled()

    // An observer, not a one-shot cache read: a pack that lands while the
    // empty rail is on screen has to bring the button to life.
    testQueryClient.setQueryData(['door-knocking-pack'], pack)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create list' })).toBeEnabled(),
    )
  })

  // The pack is the page's, and it is tens of megabytes. The rail reads it to
  // agree with the header button, never to fetch it.
  it('fetches no pack of its own to decide that', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })

    renderList({ onCreateList: vi.fn() })

    await screen.findByRole('button', { name: 'Create list' })
    expect(
      fetchSpy.mock.calls.filter(([input]) => String(input).includes('/pack')),
    ).toHaveLength(0)
    fetchSpy.mockRestore()
  })

  // Without a handler there is no flow to open, so the card keeps the pointer
  // it had rather than rendering a button that does nothing.
  it('points at the header button when there is no create handler', async () => {
    api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [] })
    testQueryClient.setQueryData(['door-knocking-pack'], pack)

    renderList()

    expect(await screen.findByText(/No lists yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create list' })).toBeNull()
    expect(screen.getByText(/above to make your first one/)).toBeInTheDocument()
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

  // The canvas's card has no PDF affordance, and this one had grown a third
  // footer control that pushed Details and Knock — the two the canvas leads
  // with — into the corner of a 384px rail. Paper is still reachable from the
  // walk; it is not a per-row control here.
  it('puts no PDF affordance on the card', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({ id: 1, name: 'Elm St & 5th' }),
        turf({ id: 2, name: 'Riverside loop', locked: true }),
      ],
    })

    renderList()

    await screen.findByRole('button', { name: 'Elm St & 5th' })
    expect(screen.queryByRole('link', { name: 'PDF' })).toBeNull()
    // Not merely unlabelled — the card carries no link at all.
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  // The canvas puts a footprint on its primary CTA, and the rail is scanned
  // rather than read: the icon is what makes Knock findable among a dozen rows
  // of identically shaped buttons.
  it('marks the Knock CTA with the canvas shoes icon', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 1, name: 'Elm St & 5th' })],
    })

    renderList()

    const knock = await screen.findByRole('button', { name: 'Knock' })
    expect(knock.querySelector('svg.lucide-footprints')).toBeInTheDocument()
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

  // Delete belongs behind the overflow menu, as it does in the canvas: it is
  // the only control on this card that destroys anything, and exposed it was a
  // red trash icon a brushed thumb away from the row it names.
  it('keeps delete behind the overflow menu, not on the card', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({ id: 1, name: 'Elm St & 5th' }),
        turf({ id: 2, name: 'Riverside loop' }),
      ],
    })

    const user = userEvent.setup()
    renderList()

    await screen.findByRole('button', { name: 'Elm St & 5th' })
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()

    // The menu button is named per list rather than a column of identical
    // kebabs, so a rail of a dozen rows doesn't read as one repeated control.
    await user.click(
      screen.getByRole('button', { name: 'More options for Elm St & 5th' }),
    )
    expect(
      await screen.findByRole('menuitem', { name: 'Delete list' }),
    ).toBeInTheDocument()
    // Only the opened row's menu, never both.
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
  })

  // Delete works at every stage — an unlocked list is hard-deleted, a knocked
  // one tombstoned — so the confirmation dialog is the guard.
  it('warns that a knocked list keeps its route', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 2, name: 'Riverside loop', locked: true })],
    })

    const user = userEvent.setup()
    renderList()

    await user.click(
      await screen.findByRole('button', {
        name: 'More options for Riverside loop',
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete list' }),
    )

    // The two deletes destroy very different amounts, so the confirmation
    // says which one is about to run.
    expect(
      await screen.findByText(/The route you paid for/),
    ).toBeInTheDocument()
  })

  // The menu unmounts its own content the moment an item is selected, so a
  // confirmation rendered inside it would be torn down before it could ever
  // appear. This is the regression that pattern invites, asserted directly.
  it('survives the menu closing on select', async () => {
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
    const user = userEvent.setup()

    renderList({ onDeletedTurf })

    await user.click(
      await screen.findByRole('button', {
        name: 'More options for Elm St & 5th',
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete list' }),
    )

    // The menu is gone and the confirmation is up.
    await waitFor(() =>
      expect(screen.queryAllByRole('menuitem')).toHaveLength(0),
    )
    expect(await screen.findByText(/removed for good/)).toBeInTheDocument()
    // Opening the confirm alone must not delete a list out from under someone.
    expect(deletedId).toBeUndefined()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deletedId).toBe('1'))
    expect(onDeletedTurf).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    )
  })

  // Hiding quiets an outline; it does not archive a list. The row keeps every
  // affordance so a hidden list is still one Knock away.
  it('keeps Details and Knock on a hidden list', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 2, name: 'Riverside loop', locked: true })],
    })

    renderList({ hiddenTurfIds: new Set([2]) })

    expect(
      await screen.findByRole('button', { name: 'Details' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Knock' })).toBeInTheDocument()
  })
})

describe('TurfList lifecycle', () => {
  beforeEach(() => {
    testQueryClient.clear()
    successSnackbar.mockClear()
    errorSnackbar.mockClear()
  })

  // Ending the session is the one rail action with no undo beside it, so it is
  // inside the expanded card rather than the always-visible footer — and the
  // card expands on the same tap that scopes the map to the list.
  it('hides the done control until the card is the selected one', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 2, name: 'Riverside loop', locked: true })],
    })

    const { rerender } = renderList()

    expect(await screen.findByText('Riverside loop')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Mark this list done/ }),
    ).toBeNull()

    rerender(
      <TurfList
        selectedTurfId={2}
        hiddenTurfIds={new Set()}
        onFocusTurf={vi.fn()}
        onToggleTurfVisibility={vi.fn()}
        onShowDetails={vi.fn()}
        onKnockTurf={vi.fn()}
        onDeletedTurf={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: /Mark this list done/ }),
    ).toBeInTheDocument()
  })

  // All three transitions require a route server-side, so a list that was never
  // knocked has nothing to end: offering it would render a control whose only
  // possible outcome is a 409.
  it('offers no done control on a list that was never knocked', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 1, name: 'Elm St & 5th' })],
    })

    renderList({ selectedTurfId: 1 })

    expect(await screen.findByText('Elm St & 5th')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Mark this list done/ }),
    ).toBeNull()
  })

  it('ends the knocking session from the expanded card', async () => {
    let completedId: string | undefined
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 2, name: 'Riverside loop', locked: true })],
    })
    api.mock('POST /v1/door-knocking/turfs/:id/complete', ({ params }) => {
      completedId = params.id
      return {
        status: 200,
        data: turf({
          id: 2,
          name: 'Riverside loop',
          locked: true,
          completedAt: new Date('2026-08-24T00:00:00Z'),
        }),
      }
    })

    renderList({ selectedTurfId: 2 })

    fireEvent.click(
      await screen.findByRole('button', { name: /Mark this list done/ }),
    )

    await waitFor(() => expect(completedId).toBe('2'))
    expect(successSnackbar).toHaveBeenCalledWith('List marked done')
  })

  // The CTA the canvas asks for: Knock while there is walking left, Move to
  // Archive once the list is done.
  it('swaps Knock for Move to archive on a done list', async () => {
    let archivedBody: unknown
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({
          id: 2,
          name: 'Riverside loop',
          locked: true,
          completedAt: new Date('2026-08-20T00:00:00Z'),
        }),
      ],
    })
    api.mock('POST /v1/door-knocking/turfs/:id/archive', ({ body }) => {
      archivedBody = body
      return {
        status: 200,
        data: turf({
          id: 2,
          name: 'Riverside loop',
          locked: true,
          completedAt: new Date('2026-08-20T00:00:00Z'),
          archivedAt: new Date('2026-08-24T00:00:00Z'),
        }),
      }
    })

    renderList()

    expect(await screen.findByText('Done')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Knock' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Move to archive/ }))

    await waitFor(() => expect(archivedBody).toEqual({ archived: true }))
    expect(successSnackbar).toHaveBeenCalledWith('Moved to archive')
  })

  // GET /turfs returns archived rows deliberately, carrying archivedAt, so the
  // sectioning is the client's. They come off the active rail — that is what
  // archiving is for — but they stay listed and restorable: a one-tap action
  // with no way back is the trap this section exists to avoid.
  it('sections archived lists out of the rail and offers Restore', async () => {
    let archivedBody: unknown
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({ id: 1, name: 'Elm St & 5th' }),
        turf({
          id: 2,
          name: 'Riverside loop',
          locked: true,
          completedAt: new Date('2026-08-20T00:00:00Z'),
          archivedAt: new Date('2026-08-22T00:00:00Z'),
        }),
      ],
    })
    api.mock('POST /v1/door-knocking/turfs/:id/archive', ({ body }) => {
      archivedBody = body
      return {
        status: 200,
        data: turf({ id: 2, name: 'Riverside loop', locked: true }),
      }
    })

    renderList()

    // The active count excludes the archived row, which has a heading and a
    // count of its own.
    expect(await screen.findByText('Saved lists (1)')).toBeInTheDocument()
    expect(screen.getByText('Archived (1)')).toBeInTheDocument()
    expect(screen.getByText('Riverside loop')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Restore/ }))

    await waitFor(() => expect(archivedBody).toEqual({ archived: false }))
    expect(successSnackbar).toHaveBeenCalledWith('Restored from archive')
  })

  // A failed transition has to name itself: three of them sit on one card, and
  // "something went wrong" leaves a candidate who pressed two of them guessing.
  it('says which transition failed', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [turf({ id: 2, name: 'Riverside loop', locked: true })],
    })
    api.mock('POST /v1/door-knocking/turfs/:id/complete', {
      status: 500,
      data: { message: 'boom' },
    })

    renderList({ selectedTurfId: 2 })

    fireEvent.click(
      await screen.findByRole('button', { name: /Mark this list done/ }),
    )

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        'This list could not be marked done. Try again.',
      ),
    )
  })

  // Archiving every list empties the rail without emptying the account, so the
  // "No lists yet" copy would be a lie and the archived section the only thing
  // on screen with no explanation of how to get back.
  it('explains an all-archived rail rather than reading as a new account', async () => {
    api.mock('GET /v1/door-knocking/turfs', {
      status: 200,
      data: [
        turf({
          id: 2,
          name: 'Riverside loop',
          locked: true,
          completedAt: new Date('2026-08-20T00:00:00Z'),
          archivedAt: new Date('2026-08-22T00:00:00Z'),
        }),
      ],
    })

    renderList()

    expect(
      await screen.findByText(/Every list is archived/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/No lists yet/)).toBeNull()
  })
})

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

// `live` is what GET /turfs reports, which is what the affordance reads —
// separate from the prop so the stale-snapshot case is expressible.
const renderSheet = ({
  prop = {},
  live,
  onDeleted = vi.fn(),
}: {
  prop?: Partial<DoorKnockingTurf>
  live?: Partial<DoorKnockingTurf>
  onDeleted?: () => void
} = {}) => {
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
  api.mock('GET /v1/door-knocking/turfs', {
    status: 200,
    data: [turf(live ?? prop)],
  })
  render(
    <TurfDetailsSheet
      turf={turf(prop)}
      areaStats={null}
      onClose={vi.fn()}
      onDeleted={onDeleted}
    />,
  )
  return { onDeleted }
}

describe('TurfDetailsSheet delete', () => {
  beforeEach(() => {
    testQueryClient.clear()
    successSnackbar.mockClear()
    errorSnackbar.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  // gp-api's assertNotLocked 409s on a knocked turf, so offering the button
  // there would only ever produce an error.
  it('offers delete only while the turf is unlocked', () => {
    renderSheet({ prop: { locked: true } })
    expect(screen.queryByLabelText('Delete Elm St & 5th')).toBeNull()
  })

  // The prop is a snapshot taken when the row was clicked, so a turf knocked
  // since then must not still offer delete.
  it('retires the affordance when the live row is locked but the prop is stale', async () => {
    renderSheet({ prop: { locked: false }, live: { locked: true } })

    await waitFor(() =>
      expect(screen.queryByLabelText('Delete Elm St & 5th')).toBeNull(),
    )
  })

  // Same stale snapshot, other direction: the route exists once it's locked, so
  // gating the route query on the prop would report it as never knocked.
  it('loads the route for a turf locked since the sheet opened', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
    renderSheet({ prop: { locked: false }, live: { locked: true } })

    await waitFor(() =>
      expect(screen.queryByText('Not knocked yet')).toBeNull(),
    )
    // 1860s of walking, rendered by the sheet's duration formatter.
    expect(screen.getByText('31m')).toBeInTheDocument()
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

describe('TurfDetailsSheet edit', () => {
  beforeEach(() => {
    testQueryClient.clear()
    successSnackbar.mockClear()
    errorSnackbar.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  const openEditor = async () => {
    fireEvent.click(await screen.findByLabelText('Edit Elm St & 5th'))
    return screen.findByRole('textbox')
  }

  // gp-api's update asserts not-locked too — the endpoint also accepts geoPoly,
  // and the polygon is what the frozen route was computed from.
  it('offers edit only while the turf is unlocked', () => {
    renderSheet({ prop: { locked: true } })
    expect(screen.queryByLabelText('Edit Elm St & 5th')).toBeNull()
  })

  it('retires the affordance when the live row is locked but the prop is stale', async () => {
    renderSheet({ prop: { locked: false }, live: { locked: true } })

    await waitFor(() =>
      expect(screen.queryByLabelText('Edit Elm St & 5th')).toBeNull(),
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

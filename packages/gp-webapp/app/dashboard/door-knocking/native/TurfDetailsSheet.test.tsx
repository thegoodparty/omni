import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import TurfDetailsSheet from './TurfDetailsSheet'

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

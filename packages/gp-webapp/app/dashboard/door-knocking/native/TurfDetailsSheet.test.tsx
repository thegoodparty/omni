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
vi.mocked(useSnackbar).mockReturnValue({
  successSnackbar,
  errorSnackbar: vi.fn(),
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

const renderSheet = (
  overrides: Partial<DoorKnockingTurf> = {},
  onDeleted = vi.fn(),
) => {
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
  render(
    <TurfDetailsSheet
      turf={turf(overrides)}
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
  })

  // gp-api's assertNotLocked 409s on a knocked turf, so offering the button
  // there would only ever produce an error.
  it('offers delete only while the turf is unlocked', () => {
    renderSheet({ locked: true })
    expect(screen.queryByLabelText('Delete Elm St & 5th')).toBeNull()
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

  it('explains a 409 in the dialog instead of closing it', async () => {
    api.mock('DELETE /v1/door-knocking/turfs/:id', {
      status: 409,
      data: { message: 'frozen' },
    })
    const { onDeleted } = renderSheet()

    fireEvent.click(screen.getByLabelText('Delete Elm St & 5th'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    // Still open, so the user reads why rather than watching it vanish.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /already been knocked/,
    )
    expect(onDeleted).not.toHaveBeenCalled()
  })
})

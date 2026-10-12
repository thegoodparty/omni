import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { EditNameDialog } from './EditNameDialog'

vi.mock('gpApi/clientFetch', () => ({ clientFetch: vi.fn() }))

const setUser = vi.fn()
vi.mock('@shared/hooks/useUser', () => ({
  useUser: vi.fn(() => [{ id: 42 }, setUser, false]),
}))

import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'

const mockClientFetch = vi.mocked(clientFetch)

const renderDialog = (onOpenChange = vi.fn()) => {
  render(
    <EditNameDialog
      open
      onOpenChange={onOpenChange}
      firstName="Sumit"
      lastName="Garg"
    />,
  )
  return onOpenChange
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EditNameDialog', () => {
  it('submits the new name to PUT /users/me and updates the user', async () => {
    const updated = { id: 42, firstName: 'Deepti', lastName: 'Garg' }
    mockClientFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: updated,
    } as Awaited<ReturnType<typeof clientFetch>>)
    const onOpenChange = renderDialog()

    fireEvent.change(screen.getByLabelText('First name'), {
      target: { value: ' Deepti ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockClientFetch).toHaveBeenCalledWith(apiRoutes.user.updateUser, {
        firstName: 'Deepti',
        lastName: 'Garg',
      }),
    )
    await waitFor(() => expect(setUser).toHaveBeenCalledWith(updated))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows an error and keeps the dialog open when saving fails', async () => {
    mockClientFetch.mockResolvedValue({
      ok: false,
      status: 500,
      data: {},
    } as Awaited<ReturnType<typeof clientFetch>>)
    const onOpenChange = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/could not save your name/i)).toBeVisible()
    expect(setUser).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('blocks saving an empty name', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('Last name'), {
      target: { value: '  ' },
    })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

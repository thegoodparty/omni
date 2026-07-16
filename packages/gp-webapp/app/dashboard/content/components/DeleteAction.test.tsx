import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/',
}))

vi.mock('gpApi/clientFetch', () => ({
  clientFetch: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))

import { clientFetch } from 'gpApi/clientFetch'
import { useSnackbar } from 'helpers/useSnackbar'
import DeleteAction from './DeleteAction'

const mockClientFetch = vi.mocked(clientFetch)
const successSnackbar = vi.fn()
const errorSnackbar = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSnackbar).mockReturnValue({
    successSnackbar,
    errorSnackbar,
    displaySnackbar: vi.fn(),
  })
})

describe('<DeleteAction>', () => {
  it('navigates to the content list via router after a successful delete', async () => {
    mockClientFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: {},
    })

    render(
      <DeleteAction documentKey="doc-1" showDelete setShowDelete={vi.fn()} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Proceed' }))

    await waitFor(() => expect(successSnackbar).toHaveBeenCalledWith('Deleted'))
    expect(push).toHaveBeenCalledWith('/dashboard/content')
    expect(refresh).toHaveBeenCalled()
  })

  it('does not navigate when the delete fails', async () => {
    mockClientFetch.mockRejectedValue(new Error('boom'))

    render(
      <DeleteAction documentKey="doc-1" showDelete setShowDelete={vi.fn()} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Proceed' }))

    await waitFor(() => expect(errorSnackbar).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})

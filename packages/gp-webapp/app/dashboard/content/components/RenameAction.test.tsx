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
import RenameAction from './RenameAction'

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

describe('<RenameAction>', () => {
  it('navigates to the content list via router when tableVersion is true', async () => {
    mockClientFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: {},
    })

    render(
      <RenameAction
        documentKey="doc-1"
        showRename
        setShowRename={vi.fn()}
        tableVersion
      />,
    )

    await userEvent.type(
      screen.getByPlaceholderText('Enter document name'),
      'New Name',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(successSnackbar).toHaveBeenCalledWith('Renamed document'),
    )
    expect(push).toHaveBeenCalledWith('/dashboard/content')
    expect(refresh).toHaveBeenCalled()
  })

  it('updates the document name locally instead of navigating when tableVersion is not set', async () => {
    mockClientFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: {},
    })
    const setDocumentName = vi.fn()

    render(
      <RenameAction
        documentKey="doc-1"
        showRename
        setShowRename={vi.fn()}
        setDocumentName={setDocumentName}
      />,
    )

    await userEvent.type(
      screen.getByPlaceholderText('Enter document name'),
      'New Name',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(setDocumentName).toHaveBeenCalledWith('New Name'),
    )
    expect(push).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})

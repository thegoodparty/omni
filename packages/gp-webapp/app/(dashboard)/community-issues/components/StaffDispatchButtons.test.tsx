import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useUser } from '@shared/hooks/useUser'
import { useSnackbar } from 'helpers/useSnackbar'
import StaffDispatchButtons from './StaffDispatchButtons'

vi.mock('@shared/hooks/useUser', () => ({
  useUser: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

const mockSuccessSnackbar = vi.fn()
const mockErrorSnackbar = vi.fn()

const setUser = (email: string | null) =>
  vi
    .mocked(useUser)
    .mockReturnValue([email ? ({ email } as any) : null, vi.fn(), false])

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSnackbar).mockReturnValue({
    successSnackbar: mockSuccessSnackbar,
    errorSnackbar: mockErrorSnackbar,
    displaySnackbar: vi.fn(),
  })
})

describe('<StaffDispatchButtons>', () => {
  it('renders nothing for a non-goodparty user', () => {
    setUser('candidate@example.com')

    const { container } = render(<StaffDispatchButtons />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there is no user', () => {
    setUser(null)

    const { container } = render(<StaffDispatchButtons />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders both dispatch buttons for a @goodparty.org user', () => {
    setUser('staff@goodparty.org')

    render(<StaffDispatchButtons />)

    expect(
      screen.getByRole('button', { name: /dispatch top community issues/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /dispatch trending issues/i }),
    ).toBeInTheDocument()
  })

  it('shows a success snackbar when a run is dispatched', async () => {
    setUser('staff@goodparty.org')
    api.mock('POST /v1/community-issues/self-dispatch', {
      status: 200,
      data: { dispatched: 1, skipped: 0 },
    })
    const user = userEvent.setup()

    render(<StaffDispatchButtons />)
    await user.click(
      screen.getByRole('button', { name: /dispatch top community issues/i }),
    )

    await waitFor(() => expect(mockSuccessSnackbar).toHaveBeenCalled())
    expect(mockErrorSnackbar).not.toHaveBeenCalled()
  })

  it('shows an error snackbar when nothing is dispatched (skipped)', async () => {
    setUser('staff@goodparty.org')
    api.mock('POST /v1/community-issues/self-dispatch', {
      status: 200,
      data: { dispatched: 0, skipped: 1 },
    })
    const user = userEvent.setup()

    render(<StaffDispatchButtons />)
    await user.click(
      screen.getByRole('button', { name: /dispatch trending issues/i }),
    )

    await waitFor(() => expect(mockErrorSnackbar).toHaveBeenCalled())
    expect(mockSuccessSnackbar).not.toHaveBeenCalled()
  })

  it('shows an error snackbar when the request fails', async () => {
    setUser('staff@goodparty.org')
    api.mock('POST /v1/community-issues/self-dispatch', {
      status: 403,
      data: {},
    })
    const user = userEvent.setup()

    render(<StaffDispatchButtons />)
    await user.click(
      screen.getByRole('button', { name: /dispatch top community issues/i }),
    )

    await waitFor(() => expect(mockErrorSnackbar).toHaveBeenCalled())
  })
})

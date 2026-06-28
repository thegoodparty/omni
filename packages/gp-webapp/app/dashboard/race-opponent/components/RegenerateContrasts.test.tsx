import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import RegenerateContrasts from './RegenerateContrasts'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => '/',
}))

vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))

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

const clickRefresh = () =>
  userEvent.click(screen.getByRole('button', { name: /refresh contrasts/i }))

describe('<RegenerateContrasts>', () => {
  it('generates contrasts and refreshes the page on success', async () => {
    api.mock('POST /v1/campaigns/mine/race-opponent/contrasts/generate', {
      status: 200,
      data: { contrasts: [], routedToReviewCount: 1 },
    })

    render(<RegenerateContrasts />)
    await clickRefresh()

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(successSnackbar).toHaveBeenCalled()
  })

  it('surfaces an error and does not refresh when generation fails', async () => {
    api.mock('POST /v1/campaigns/mine/race-opponent/contrasts/generate', {
      status: 500,
      data: { error: 'boom' },
    })

    render(<RegenerateContrasts />)
    await clickRefresh()

    await waitFor(() => expect(errorSnackbar).toHaveBeenCalled())
    expect(refresh).not.toHaveBeenCalled()
  })
})

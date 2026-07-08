import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'

vi.mock('gpApi/typed-request', () => ({
  clientRequest: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
}))

// ServeOfficePicker loads positions for a ZIP through the legacy clientFetch.
vi.mock('gpApi/clientFetch', () => ({
  clientFetch: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    data: [
      {
        brPositionId: 'br-1',
        position: {
          id: 'p1',
          name: 'City Council',
          level: 'Local',
          state: 'ME',
        },
        city: 'Rockland',
      },
    ],
  }),
}))

vi.mock('@shared/organization-picker', () => ({
  ORGANIZATIONS_QUERY_KEY: ['organizations'],
}))

vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

import { clientRequest } from 'gpApi/typed-request'
import { ElectedOfficeSelectionModal } from './ElectedOfficeSelectionModal'

beforeEach(() => {
  vi.clearAllMocks()
  testQueryClient.clear()
})

const searchAndAwaitResults = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> => {
  await user.type(
    screen.getByPlaceholderText('Enter 5 digit zip code'),
    '04841',
  )
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByRole('radio', { name: /City Council/i })
}

describe('ElectedOfficeSelectionModal', () => {
  it('records the chosen position on the organization and not on a campaign', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const onClose = vi.fn()

    render(
      <ElectedOfficeSelectionModal
        show
        onClose={onClose}
        onSaved={onSaved}
        organizationSlug="eo-1"
      />,
    )

    await searchAndAwaitResults(user)
    await user.click(screen.getByRole('radio', { name: /City Council/i }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(clientRequest).toHaveBeenCalledWith(
        'PATCH /v1/organizations/:slug',
        {
          slug: 'eo-1',
          ballotReadyPositionId: 'br-1',
          customPositionName: null,
        },
      ),
    )
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('saves a custom office name when the office is not listed', async () => {
    const user = userEvent.setup()
    render(
      <ElectedOfficeSelectionModal
        show
        onClose={vi.fn()}
        organizationSlug="eo-1"
      />,
    )

    await searchAndAwaitResults(user)
    await user.click(
      screen.getByRole('button', { name: /don.t see my office/i }),
    )

    await user.type(screen.getByLabelText('Office name'), 'Town Selectboard')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(clientRequest).toHaveBeenCalledWith(
        'PATCH /v1/organizations/:slug',
        {
          slug: 'eo-1',
          ballotReadyPositionId: null,
          customPositionName: 'Town Selectboard',
        },
      ),
    )
  })
})

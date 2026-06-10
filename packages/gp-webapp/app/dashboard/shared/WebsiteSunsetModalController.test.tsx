import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'

vi.mock('gpApi/clientFetch', () => ({
  clientFetch: vi.fn(),
}))

const mockSetUser = vi.fn()
let mockUserValue: [
  { id: number; metaData?: { websiteSunsetModalDismissed?: boolean } } | null,
  () => void,
  boolean,
]
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => mockUserValue,
}))

import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import { WebsiteSunsetModalController } from './WebsiteSunsetModalController'

const mockClientFetch = vi.mocked(clientFetch)
const TITLE = 'Our build your own website feature is being discontinued'

beforeEach(() => {
  vi.clearAllMocks()
  mockUserValue = [{ id: 1, metaData: {} }, mockSetUser, false]
  vi.spyOn(window, 'open').mockReturnValue(null)
})

describe('WebsiteSunsetModalController', () => {
  it('opens the modal for an eligible candidate who has not dismissed it', () => {
    render(<WebsiteSunsetModalController eligible />)

    expect(screen.getByText(TITLE)).toBeInTheDocument()
  })

  it('does not open when the candidate already dismissed it', () => {
    mockUserValue = [
      { id: 1, metaData: { websiteSunsetModalDismissed: true } },
      mockSetUser,
      false,
    ]

    render(<WebsiteSunsetModalController eligible />)

    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  it('does not open when the candidate is not eligible', () => {
    render(<WebsiteSunsetModalController eligible={false} />)

    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  it('does not open while the user is still loading', () => {
    mockUserValue = [null, mockSetUser, true]

    render(<WebsiteSunsetModalController eligible />)

    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  it('persists dismissal to the candidate metadata when closed', async () => {
    mockClientFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: { id: 1 },
    })

    render(<WebsiteSunsetModalController eligible />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Transfer website' }),
    )

    await waitFor(() => {
      expect(mockClientFetch).toHaveBeenCalledWith(apiRoutes.user.updateMeta, {
        meta: { websiteSunsetModalDismissed: true },
      })
    })
    // Optimistically flips the flag on the enriched cached user...
    expect(mockSetUser).toHaveBeenCalledWith({
      id: 1,
      metaData: { websiteSunsetModalDismissed: true },
    })
    // ...then refetches GET /users/me (no argument) once the PUT succeeds.
    await waitFor(() => {
      expect(mockSetUser).toHaveBeenCalledWith()
    })
  })

  it('keeps the dismissal in cache when the persist call fails', async () => {
    mockClientFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      data: null,
    })

    render(<WebsiteSunsetModalController eligible />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Transfer website' }),
    )

    await waitFor(() => {
      expect(mockClientFetch).toHaveBeenCalled()
    })
    // Optimistic update still flips the flag, so a failed PUT can't reopen it.
    expect(mockSetUser).toHaveBeenCalledWith({
      id: 1,
      metaData: { websiteSunsetModalDismissed: true },
    })
    // No enriched refetch on failure.
    expect(mockSetUser).not.toHaveBeenCalledWith()
  })
})

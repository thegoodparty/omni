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
    expect(mockSetUser).toHaveBeenCalledWith({ id: 1 })
  })
})

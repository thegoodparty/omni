import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { User } from 'helpers/types'

let mockUser: User | null
const setUser = vi.fn()
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [mockUser, setUser, false],
}))

vi.mock('gpApi/clientFetch', () => ({
  clientFetch: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importActual) => {
  const actual = await importActual<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import NotificationSection from './NotificationSection'

const userWithMeta = (meta: Record<string, unknown>): User =>
  ({ id: 1, email: 'a@b.com', metaData: meta }) as unknown as User

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(clientFetch).mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    data: { id: 1, metaData: { marketingEmails: true } },
  } as never)
})

describe('NotificationSection — channel gating', () => {
  it('hides campaign channels for an elected official', () => {
    mockUser = userWithMeta({})
    render(<NotificationSection showCampaignChannels={false} />)

    expect(screen.getByText('Marketing emails')).toBeInTheDocument()
    expect(screen.getByText('Weekly newsletter')).toBeInTheDocument()
    expect(screen.queryByText('Campaign emails')).not.toBeInTheDocument()
    expect(screen.queryByText('Campaign text messages')).not.toBeInTheDocument()
  })
})

describe('NotificationSection — saving preferences', () => {
  it('persists a marketing toggle via updateMeta and updates the user', async () => {
    mockUser = userWithMeta({ marketingEmails: false })
    const user = userEvent.setup()
    render(<NotificationSection showCampaignChannels={false} />)

    // EO order: [Marketing emails, Weekly newsletter].
    const marketing = screen.getAllByRole('switch')[0]!
    await user.click(marketing)

    await waitFor(() => expect(clientFetch).toHaveBeenCalledTimes(1))
    expect(clientFetch).toHaveBeenCalledWith(apiRoutes.user.updateMeta, {
      meta: expect.objectContaining({ marketingEmails: true }),
    })
    // The returned user is pushed back into context (the "refetch").
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })
})

describe('NotificationSection — campaign channel guard rails', () => {
  it('confirms before turning off a campaign channel, then saves', async () => {
    mockUser = userWithMeta({
      notificationEmails: true,
      textNotifications: true,
    })
    const user = userEvent.setup()
    render(<NotificationSection showCampaignChannels />)

    // Campaign order: [Campaign emails, Campaign texts, Marketing, Newsletter].
    const campaignEmails = screen.getAllByRole('switch')[0]!
    await user.click(campaignEmails)

    expect(
      await screen.findByText(
        'Are you sure you want to turn off campaign emails?',
      ),
    ).toBeInTheDocument()
    // Not saved until confirmed.
    expect(clientFetch).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Turn off emails' }))

    await waitFor(() => expect(clientFetch).toHaveBeenCalledTimes(1))
    expect(clientFetch).toHaveBeenCalledWith(apiRoutes.user.updateMeta, {
      meta: expect.objectContaining({ notificationEmails: false }),
    })
  })

  it('blocks turning off the last remaining campaign channel', async () => {
    mockUser = userWithMeta({
      notificationEmails: true,
      textNotifications: false,
    })
    const user = userEvent.setup()
    render(<NotificationSection showCampaignChannels />)

    const campaignEmails = screen.getAllByRole('switch')[0]!
    await user.click(campaignEmails)

    expect(
      await screen.findByText('Keep at least one channel on'),
    ).toBeInTheDocument()
    expect(clientFetch).not.toHaveBeenCalled()
  })
})

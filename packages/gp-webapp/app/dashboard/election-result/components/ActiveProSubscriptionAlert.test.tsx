import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { clientFetch } from 'gpApi/clientFetch'
import { ActiveProSubscriptionAlert } from './ActiveProSubscriptionAlert'

type MockCampaign = {
  id: number
  isPro?: boolean
  details?: {
    electionDate?: string
    subscriptionId?: string
    subscriptionCancelAt?: number
  }
} | null

const { mockCampaign } = vi.hoisted(() => ({
  mockCampaign: { current: null as MockCampaign },
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [mockCampaign.current],
}))

vi.mock('gpApi/clientFetch', () => ({
  clientFetch: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', () => ({
  EVENTS: {
    Settings: { Account: { ClickManageSubscription: 'manage_subscription' } },
  },
  trackEvent: vi.fn(),
}))

const mockClientFetch = vi.mocked(clientFetch)

const proCampaign = (
  details: NonNullable<MockCampaign>['details'] = {},
): MockCampaign => ({
  id: 1,
  isPro: true,
  details: {
    electionDate: '2025-11-04',
    subscriptionId: 'sub_123',
    ...details,
  },
})

describe('ActiveProSubscriptionAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCampaign.current = proCampaign()
    // The portal button navigates via window.location.href; stub it so jsdom
    // does not attempt a real navigation.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    })
  })

  it('shows the billing portal button for a Pro campaign with an active subscription', () => {
    render(<ActiveProSubscriptionAlert />)

    expect(
      screen.getByText(/Pro subscription is still active/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Manage subscription' }),
    ).toBeInTheDocument()
  })

  it('redirects to the Stripe billing portal when clicked', async () => {
    mockClientFetch.mockResolvedValue({
      data: { redirectUrl: 'https://billing.stripe.com/p/session/xyz' },
    } as never)

    render(<ActiveProSubscriptionAlert />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Manage subscription' }),
    )

    await waitFor(() => {
      expect(window.location.href).toBe(
        'https://billing.stripe.com/p/session/xyz',
      )
    })
  })

  it('renders nothing for a non-Pro campaign', () => {
    mockCampaign.current = { id: 1, isPro: false, details: {} }

    const { container } = render(<ActiveProSubscriptionAlert />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a Pro campaign with no linked subscription (comped)', () => {
    mockCampaign.current = proCampaign({ subscriptionId: undefined })

    const { container } = render(<ActiveProSubscriptionAlert />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when a cancellation is already pending', () => {
    mockCampaign.current = proCampaign({ subscriptionCancelAt: 1786124166 })

    const { container } = render(<ActiveProSubscriptionAlert />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the campaign has not loaded', () => {
    mockCampaign.current = null

    const { container } = render(<ActiveProSubscriptionAlert />)

    expect(container).toBeEmptyDOMElement()
  })
})

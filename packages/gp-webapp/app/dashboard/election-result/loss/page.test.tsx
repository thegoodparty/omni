import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import LossPage from './page'

type MockCampaign = {
  id: number
  isPro?: boolean
  details?: { subscriptionId?: string }
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

describe('LossPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCampaign.current = null
  })

  it('surfaces the billing portal for a Pro campaign with an active subscription', () => {
    mockCampaign.current = {
      id: 1,
      isPro: true,
      details: { subscriptionId: 'sub_123' },
    }

    render(<LossPage />)

    expect(
      screen.getByText(/Pro subscription is still active/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Manage subscription' }),
    ).toBeInTheDocument()
  })

  it('shows no subscription alert for a non-Pro campaign', () => {
    mockCampaign.current = { id: 1, isPro: false, details: {} }

    render(<LossPage />)

    expect(screen.getByText(/Not every campaign wins/i)).toBeInTheDocument()
    expect(screen.queryByText(/Pro subscription is still active/i)).toBeNull()
  })
})

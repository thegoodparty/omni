import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { router } from 'helpers/test-utils/router-mocking'
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

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Sarah' }],
}))

vi.mock('app/dashboard/contacts/citizens-panel/managedPanelCopy', () => ({
  useServePlace: () => 'Maplewood',
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

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn() }),
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

    expect(
      screen.getByRole('heading', { name: 'Thank you for running, Sarah' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Pro subscription is still active/i)).toBeNull()
  })

  it('points to the community and back to the dashboard', () => {
    mockCampaign.current = { id: 1, isPro: false, details: {} }

    render(<LossPage />)

    expect(
      screen.getByText(
        'Learn how to run again, or how to support the officials serving Maplewood.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Join the community/ }),
    ).toHaveAttribute('href', 'https://community.goodparty.org')
    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }))
    expect(router.replace).toHaveBeenCalledWith('/dashboard')
  })
})

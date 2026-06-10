import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { UserContext } from '@shared/user/UserProvider'
import { useProUpgrade3Flag } from '@shared/experiments/proUpgrade3Flag'
import type { Campaign, User } from 'helpers/types'
import AlertSection from './AlertSection'

vi.mock('@shared/experiments/proUpgrade3Flag', () => ({
  useProUpgrade3Flag: vi.fn(),
}))

const mockUseProUpgrade3Flag = vi.mocked(useProUpgrade3Flag)

// metaData with a checkoutSessionId but no customerId/subscriptionId is the
// "started checkout, never completed" state that triggers the legacy alert.
const startedCheckoutUser = {
  id: 1,
  metaData: { checkoutSessionId: 'cs_test_123' },
} as User

// checkoutSessionId + customerId but no subscriptionId is the "paid, waiting
// for the subscription to activate" state that triggers the pending alert.
const pendingSubscriptionUser = {
  id: 2,
  metaData: { checkoutSessionId: 'cs_test_456', customerId: 'cus_test_456' },
} as User

const renderSection = (user: User, campaign: Campaign) =>
  render(
    <UserContext.Provider value={[user, vi.fn(), false]}>
      <AlertSection campaign={campaign} />
    </UserContext.Provider>,
  )

describe('AlertSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the complete-pro-sign-up alert for the legacy cohort mid-checkout', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: true, enabled: false })
    renderSection(startedCheckoutUser, { isPro: false } as Campaign)

    expect(
      screen.getByText('Please complete your pro sign up!'),
    ).toBeInTheDocument()
  })

  it('hides the legacy alert for the pro-upgrade3 cohort', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: true, enabled: true })
    renderSection(startedCheckoutUser, { isPro: false } as Campaign)

    expect(
      screen.queryByText('Please complete your pro sign up!'),
    ).not.toBeInTheDocument()
  })

  it('hides the legacy alert until the flag resolves', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: false, enabled: false })
    renderSection(startedCheckoutUser, { isPro: false } as Campaign)

    expect(
      screen.queryByText('Please complete your pro sign up!'),
    ).not.toBeInTheDocument()
  })

  it('shows the subscription-pending alert for the legacy cohort', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: true, enabled: false })
    renderSection(pendingSubscriptionUser, { isPro: false } as Campaign)

    expect(screen.getByText('Subscription Pending')).toBeInTheDocument()
  })

  it('hides the subscription-pending alert for the pro-upgrade3 cohort', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: true, enabled: true })
    renderSection(pendingSubscriptionUser, { isPro: false } as Campaign)

    expect(screen.queryByText('Subscription Pending')).not.toBeInTheDocument()
  })

  it('hides the subscription-pending alert until the flag resolves', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: false, enabled: false })
    renderSection(pendingSubscriptionUser, { isPro: false } as Campaign)

    expect(screen.queryByText('Subscription Pending')).not.toBeInTheDocument()
  })
})

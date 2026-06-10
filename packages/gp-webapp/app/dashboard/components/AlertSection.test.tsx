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
})

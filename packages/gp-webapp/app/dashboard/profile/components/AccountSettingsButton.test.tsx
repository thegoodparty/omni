import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { AccountSettingsButton } from './AccountSettingsButton'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn() }),
}))

describe('AccountSettingsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the upgrade button to the Pro upgrade wizard', () => {
    render(<AccountSettingsButton isPro={false} />)

    expect(screen.getByRole('link', { name: 'Upgrade Plan' })).toHaveAttribute(
      'href',
      '/dashboard/pro-upgrade?source=account_settings&channel=generic&cta=Upgrade+Plan',
    )
  })

  it('shows the manage-subscription action for Pro users instead of an upgrade link', () => {
    render(<AccountSettingsButton isPro subscriptionId="sub_1" />)

    expect(
      screen.getByRole('button', { name: /Manage Subscription/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Upgrade Plan' }),
    ).not.toBeInTheDocument()
  })

  it('shows manage-subscription for a Pro user with a customerId but no subscriptionId', () => {
    render(<AccountSettingsButton isPro customerId="cus_1" />)

    expect(
      screen.getByRole('button', { name: /Manage Subscription/ }),
    ).toBeInTheDocument()
  })

  it('shows a contact-support link for a Pro user with neither id', () => {
    render(<AccountSettingsButton isPro />)

    expect(
      screen.queryByRole('button', { name: /Manage Subscription/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Contact support/ }),
    ).toHaveAttribute('href', 'mailto:support@goodparty.org')
  })
})

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
      '/dashboard/pro-upgrade',
    )
  })

  it('shows the manage-subscription action for Pro users instead of an upgrade link', () => {
    render(<AccountSettingsButton isPro />)

    expect(
      screen.queryByRole('link', { name: 'Upgrade Plan' }),
    ).not.toBeInTheDocument()
  })
})

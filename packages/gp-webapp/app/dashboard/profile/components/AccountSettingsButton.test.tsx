import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { useProUpgradeEntryHref } from '@shared/experiments/proUpgrade3Flag'
import { AccountSettingsButton } from './AccountSettingsButton'

vi.mock('@shared/experiments/proUpgrade3Flag', () => ({
  useProUpgradeEntryHref: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockUseProUpgradeEntryHref = vi.mocked(useProUpgradeEntryHref)

describe('AccountSettingsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the cohort upgrade button to the new wizard', () => {
    mockUseProUpgradeEntryHref.mockReturnValue({
      ready: true,
      href: '/dashboard/pro-upgrade',
    })

    render(<AccountSettingsButton isPro={false} />)

    expect(screen.getByRole('link', { name: 'Upgrade Plan' })).toHaveAttribute(
      'href',
      '/dashboard/pro-upgrade',
    )
    // Off-cohort destination for this surface is the legacy pro-sign-up flow,
    // not the splash.
    expect(mockUseProUpgradeEntryHref).toHaveBeenCalledWith(
      '/dashboard/pro-sign-up',
    )
  })

  it('keeps the off-cohort upgrade button on the legacy pro-sign-up flow', () => {
    mockUseProUpgradeEntryHref.mockReturnValue({
      ready: true,
      href: '/dashboard/pro-sign-up',
    })

    render(<AccountSettingsButton isPro={false} />)

    expect(screen.getByRole('link', { name: 'Upgrade Plan' })).toHaveAttribute(
      'href',
      '/dashboard/pro-sign-up',
    )
  })

  it('shows the manage-subscription action for Pro users instead of an upgrade link', () => {
    mockUseProUpgradeEntryHref.mockReturnValue({
      ready: true,
      href: '/dashboard/pro-upgrade',
    })

    render(<AccountSettingsButton isPro />)

    expect(
      screen.queryByRole('link', { name: 'Upgrade Plan' }),
    ).not.toBeInTheDocument()
  })
})

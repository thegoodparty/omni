import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { useProUpgradeEntryHref } from '@shared/experiments/proUpgrade3Flag'
import { P2PUpgradeModal } from './P2PUpgradeModal'

vi.mock('@shared/experiments/proUpgrade3Flag', () => ({
  useProUpgradeEntryHref: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockUseProUpgradeEntryHref = vi.mocked(useProUpgradeEntryHref)

describe('P2PUpgradeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('points the NonProUpgrade CTA at the resolved upgrade href', () => {
    mockUseProUpgradeEntryHref.mockReturnValue({
      ready: true,
      href: '/dashboard/pro-upgrade',
    })

    render(<P2PUpgradeModal open variant="NonProUpgrade" onClose={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Upgrade now' })).toHaveAttribute(
      'href',
      '/dashboard/pro-upgrade',
    )
  })

  it('falls back to the legacy splash for the off-cohort caller', () => {
    mockUseProUpgradeEntryHref.mockReturnValue({
      ready: true,
      href: '/dashboard/upgrade-to-pro',
    })

    render(<P2PUpgradeModal open variant="NonProUpgrade" onClose={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Upgrade now' })).toHaveAttribute(
      'href',
      '/dashboard/upgrade-to-pro',
    )
  })

  it('feeds the legacy splash path to the fork and exposes the upgrade variant', () => {
    mockUseProUpgradeEntryHref.mockReturnValue({
      ready: true,
      href: '/dashboard/pro-upgrade',
    })

    render(<P2PUpgradeModal open variant="NonProUpgrade" onClose={vi.fn()} />)

    expect(mockUseProUpgradeEntryHref).toHaveBeenCalledWith(
      '/dashboard/upgrade-to-pro',
      true,
    )
  })

  it('does not expose the compliance variant to the pro-upgrade3 experiment', () => {
    mockUseProUpgradeEntryHref.mockReturnValue({
      ready: true,
      href: '/dashboard/pro-upgrade',
    })

    render(
      <P2PUpgradeModal
        open
        variant="ProFreeTextsNonCompliant"
        onClose={vi.fn()}
      />,
    )

    // The compliance modal never uses the upgrade href, so reading the flag
    // here must not enroll the user in the experiment's exposed population.
    expect(mockUseProUpgradeEntryHref).toHaveBeenCalledWith(
      '/dashboard/upgrade-to-pro',
      false,
    )
  })
})

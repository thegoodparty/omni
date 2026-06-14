import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { useProUpgradeEntryHref } from '@shared/experiments/proUpgrade3Flag'
import { ProUpgradeModal } from './ProUpgradeModal'

vi.mock('@shared/experiments/proUpgrade3Flag', () => ({
  useProUpgradeEntryHref: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockUseProUpgradeEntryHref = vi.mocked(useProUpgradeEntryHref)

describe('ProUpgradeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('points the upgrade CTA at the new wizard for the cohort', () => {
    mockUseProUpgradeEntryHref.mockReturnValue({
      ready: true,
      href: '/dashboard/pro-upgrade',
    })

    render(<ProUpgradeModal open variant="First" onClose={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Upgrade now' })).toHaveAttribute(
      'href',
      '/dashboard/pro-upgrade',
    )
    expect(mockUseProUpgradeEntryHref).toHaveBeenCalledWith(
      '/dashboard/upgrade-to-pro',
    )
  })

  it('keeps the off-cohort CTA on the legacy splash', () => {
    mockUseProUpgradeEntryHref.mockReturnValue({
      ready: true,
      href: '/dashboard/upgrade-to-pro',
    })

    render(<ProUpgradeModal open variant="First" onClose={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Upgrade now' })).toHaveAttribute(
      'href',
      '/dashboard/upgrade-to-pro',
    )
  })
})

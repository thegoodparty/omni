import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { P2PUpgradeModal } from './P2PUpgradeModal'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

describe('P2PUpgradeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('points the NonProUpgrade CTA at the Pro upgrade wizard', () => {
    render(<P2PUpgradeModal open variant="NonProUpgrade" onClose={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Upgrade now' })).toHaveAttribute(
      'href',
      '/dashboard/pro-upgrade',
    )
  })

  it('points the compliance variant at the texting-compliance section', () => {
    render(
      <P2PUpgradeModal
        open
        variant="ProFreeTextsNonCompliant"
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('link', { name: 'Complete Registration' }),
    ).toHaveAttribute('href', '/dashboard/account#texting-compliance')
  })
})

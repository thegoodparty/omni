import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { ProUpgradeModal } from './ProUpgradeModal'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

describe('ProUpgradeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('points the upgrade CTA at the Pro upgrade wizard', () => {
    render(
      <ProUpgradeModal
        open
        variant="First"
        onClose={vi.fn()}
        source="auto_modal"
      />,
    )

    expect(screen.getByRole('link', { name: 'Upgrade now' })).toHaveAttribute(
      'href',
      '/pro-upgrade?source=auto_modal&channel=generic&cta=Upgrade+now',
    )
  })
})

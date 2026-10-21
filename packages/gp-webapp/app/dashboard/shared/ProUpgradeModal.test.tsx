import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import type { Campaign } from 'helpers/types'
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
      '/dashboard/pro-upgrade?source=auto_modal&channel=generic&cta=Upgrade+now',
    )
  })

  describe('with texting closed for the race', () => {
    const renderClosed = (
      variant: 'First' | 'Second_NonViable' | 'Second_Viable',
    ) =>
      render(
        <CampaignContext.Provider
          value={[{ smsCompliance: 'closed' } as Campaign]}
        >
          <ProUpgradeModal open variant={variant} onClose={vi.fn()} />
        </CampaignContext.Provider>,
      )

    it.each(['First', 'Second_NonViable', 'Second_Viable'] as const)(
      'makes no texting claim in the %s variant',
      (variant) => {
        renderClosed(variant)

        expect(screen.queryByText(/text/i)).toBeNull()
      },
    )

    it('offers voicemails in place of texts in the First variant', () => {
      renderClosed('First')

      expect(screen.getByText('voicemails')).toBeInTheDocument()
    })

    it('swaps the free texts offer for outreach tools in the Second_Viable variant', () => {
      renderClosed('Second_Viable')

      expect(screen.getByText('Voice and door-knocking')).toBeInTheDocument()
      expect(
        screen.getByText('Start today for just $10/month.'),
      ).toBeInTheDocument()
    })
  })
})

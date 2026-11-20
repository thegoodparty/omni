import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import type { Campaign } from 'helpers/types'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { P2PUpgradeModal } from './P2PUpgradeModal'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const { mockPlanFlag } = vi.hoisted(() => ({
  mockPlanFlag: { enabled: false },
}))
vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({
    ready: true,
    enabled: mockPlanFlag.enabled,
  }),
}))

describe('P2PUpgradeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPlanFlag.enabled = false
  })

  it('closes when See all plans navigates away', async () => {
    mockPlanFlag.enabled = true
    const onClose = vi.fn()
    render(<P2PUpgradeModal open variant="NonProUpgrade" onClose={onClose} />)

    await userEvent.click(screen.getByRole('link', { name: 'See all plans' }))

    expect(onClose).toHaveBeenCalledTimes(1)
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

  it.each(['NonProUpgrade', 'ProFreeTextsNonCompliant'] as const)(
    'does not show the %s variant once texting has closed',
    (variant) => {
      render(
        <CampaignContext.Provider
          value={[{ smsCompliance: 'closed' } as Campaign]}
        >
          <P2PUpgradeModal open variant={variant} onClose={vi.fn()} />
        </CampaignContext.Provider>,
      )

      expect(screen.queryByText(/free texts/)).toBeNull()
      expect(screen.queryByRole('link')).toBeNull()
      expect(trackEvent).not.toHaveBeenCalledWith(
        EVENTS.P2PUpgrade.Modal.Shown,
        expect.anything(),
      )
    },
  )
})

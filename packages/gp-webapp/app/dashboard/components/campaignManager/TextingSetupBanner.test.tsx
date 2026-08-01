import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { TcrCompliance } from 'helpers/types'
import { EVENTS } from 'helpers/analyticsHelper'
import TextingSetupBanner from './TextingSetupBanner'

const mockTrackEvent = vi.fn()
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return {
    ...actual,
    trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  }
})

const mockUseCampaign = vi.fn(() => [{ isPro: true }])
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => mockUseCampaign(),
}))

const tcrWith = (status: string): TcrCompliance => ({ status }) as TcrCompliance

const HEADING = 'Finish your texting setup'

beforeEach(() => {
  vi.clearAllMocks()
  mockUseCampaign.mockReturnValue([{ isPro: true }])
})

describe('TextingSetupBanner — visibility', () => {
  it('renders for a Pro campaign with no TCR record', () => {
    render(<TextingSetupBanner tcrCompliance={null} />)
    expect(screen.getByText(HEADING)).toBeInTheDocument()
  })

  it('renders for a Pro campaign with a retryable error record', () => {
    render(<TextingSetupBanner tcrCompliance={tcrWith('error')} />)
    expect(screen.getByText(HEADING)).toBeInTheDocument()
  })

  it.each(['submitted', 'pending', 'approved', 'rejected'])(
    'renders nothing for status %s (dedicated surfaces own those states)',
    (status) => {
      render(<TextingSetupBanner tcrCompliance={tcrWith(status)} />)
      expect(screen.queryByText(HEADING)).not.toBeInTheDocument()
    },
  )

  it('renders nothing for a free campaign (ProUpgradeBanner owns that slot)', () => {
    mockUseCampaign.mockReturnValue([{ isPro: false }])
    render(<TextingSetupBanner tcrCompliance={null} />)
    expect(screen.queryByText(HEADING)).not.toBeInTheDocument()
  })
})

describe('TextingSetupBanner — CTA and analytics', () => {
  it('links the CTA to the election-filing form', () => {
    render(<TextingSetupBanner tcrCompliance={null} />)
    expect(
      screen.getByRole('link', { name: 'Start registration' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/profile/texting-compliance/election-filing',
    )
  })

  it('fires the view event when visible and the click event on the CTA', async () => {
    const user = userEvent.setup()
    render(<TextingSetupBanner tcrCompliance={null} />)

    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.TextingSetupBannerViewed,
    )
    await user.click(screen.getByRole('link', { name: 'Start registration' }))
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.TextingSetupBannerStart,
    )
  })

  it('does not fire the view event when hidden', () => {
    render(<TextingSetupBanner tcrCompliance={tcrWith('submitted')} />)
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.TextingSetupBannerViewed,
    )
  })
})

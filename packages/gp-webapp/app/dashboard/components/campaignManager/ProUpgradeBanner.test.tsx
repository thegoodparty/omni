import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import type { Campaign } from 'helpers/types'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import ProUpgradeBanner from './ProUpgradeBanner'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockTrackEvent = vi.mocked(trackEvent)

const renderBanner = (isPro: boolean | null) =>
  render(
    <CampaignContext.Provider value={[{ isPro } as Campaign]}>
      <ProUpgradeBanner />
    </CampaignContext.Provider>,
  )

describe('ProUpgradeBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the banner and tracks a view for a non-Pro candidate', () => {
    renderBanner(false)

    expect(
      screen.getByText('76% of candidates who use Pro win'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get Pro' })).toBeInTheDocument()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.BannerViewed,
    )
  })

  it('routes into the wizard and tracks the click when Get Pro is pressed', async () => {
    renderBanner(false)

    await userEvent.click(screen.getByRole('button', { name: 'Get Pro' }))

    expect(router.push).toHaveBeenCalledWith('/dashboard/pro-upgrade')
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.BannerGetPro,
    )
  })

  it('renders nothing for a Pro candidate', () => {
    const { container } = renderBanner(true)

    expect(container).toBeEmptyDOMElement()
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })
})

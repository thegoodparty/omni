import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { api } from 'helpers/test-utils/api-mocking'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { Campaign } from 'helpers/types'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import SuccessStep from './SuccessStep'

// The confetti overlay paints to a <canvas>, which jsdom can't render — stub it
// so the test exercises the success content and CTA, not the celebration.
vi.mock('app/dashboard/questions/components/Confetti', () => ({
  default: () => null,
}))

// Keep EVENTS real; stub trackEvent so we don't hit analytics in tests.
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockTrackEvent = vi.mocked(trackEvent)

const campaign = (isPro: boolean): Campaign =>
  ({ id: 1, isPro }) as unknown as Campaign

describe('SuccessStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The screen polls the campaign query while waiting for the webhook to flip
    // isPro; default the fetch to the not-yet-Pro state so individual tests can
    // override it.
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign(false) })
  })

  it('renders the Welcome-to-Pro messaging and fires the viewed event', () => {
    render(<SuccessStep />)

    expect(
      screen.getByRole('heading', { name: 'Welcome to Pro!' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /your PIN will be sent to your email, phone or address/i,
      ),
    ).toBeInTheDocument()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.SuccessViewed,
    )
  })

  it('routes to the dashboard when Continue is clicked', () => {
    render(<SuccessStep />)

    screen.getByRole('button', { name: /continue/i }).click()

    expect(router.push).toHaveBeenCalledWith('/dashboard')
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.SuccessContinue,
    )
  })

  it('does not gate the success content on isPro — it renders with no campaign state', () => {
    // The screen takes no isPro/campaign input; rendering at all (the assertion
    // above) proves it can't get stuck waiting on the webhook-driven flip.
    render(<SuccessStep />)

    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
  })

  it('polls the campaign query until isPro flips so the dashboard reflects Pro without a manual refresh', async () => {
    // Reproduces the bug: the candidate lands here with a stale cached campaign
    // (isPro=false) while the Stripe webhook is still in flight. The first fetch
    // is still not-Pro; a later poll catches the flip. The shared cache must end
    // up Pro so the dashboard's ProUpgradeBanner hides on arrival.
    testQueryClient.setQueryData(CAMPAIGN_QUERY_KEY, campaign(false))
    api.mockOrdered('GET /v1/campaigns/mine', [
      { status: 200, data: campaign(false) },
      { status: 200, data: campaign(true) },
    ])

    render(<SuccessStep />)

    await waitFor(
      () =>
        expect(
          testQueryClient.getQueryData<Campaign>(CAMPAIGN_QUERY_KEY)?.isPro,
        ).toBe(true),
      { timeout: 5000 },
    )
  })

  it('stops polling after the timeout cap when isPro never flips', async () => {
    // The safety valve: if the webhook never lands, polling must not run
    // forever. Drive fake time past the 30s cap and assert the fetch count
    // stops climbing (the interval was cleared) while isPro stays false.
    vi.useFakeTimers()
    try {
      testQueryClient.setQueryData(CAMPAIGN_QUERY_KEY, campaign(false))
      let fetchCount = 0
      api.mock('GET /v1/campaigns/mine', () => {
        fetchCount += 1
        return { status: 200, data: campaign(false) }
      })

      render(<SuccessStep />)

      // Run through the full 30s cap (plus one interval of slack).
      await vi.advanceTimersByTimeAsync(32_000)
      const callsAtCap = fetchCount

      // The interval must actually have polled before the cap — otherwise the
      // "stops climbing" check below would pass vacuously.
      expect(callsAtCap).toBeGreaterThan(1)

      // Past the cap, the interval is cleared: no further fetches fire.
      await vi.advanceTimersByTimeAsync(20_000)

      expect(fetchCount).toBe(callsAtCap)
      expect(
        testQueryClient.getQueryData<Campaign>(CAMPAIGN_QUERY_KEY)?.isPro,
      ).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

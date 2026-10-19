import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { Campaign, type TcrCompliance } from 'helpers/types'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { saveVerificationDraft } from 'app/dashboard/campaign-verification/verificationDraft'
import { PRO_UPGRADE_STEP } from '../proUpgradeStep'
import {
  ProUpgradeWizardContext,
  type ProUpgradeWizardContextValue,
} from './proUpgradeWizardContext'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import { formatSmsCutoffDate } from 'app/dashboard/campaign-verification/verificationCopy'
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

// The TCR read is the endpoint boundary that says whether the filing is in.
const mockGetTcrCompliance = vi.fn<() => Promise<TcrCompliance | null>>()
vi.mock(
  'app/dashboard/profile/texting-compliance/util/tcrCompliance.util',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('app/dashboard/profile/texting-compliance/util/tcrCompliance.util')
    >()),
    getTcrCompliance: () => mockGetTcrCompliance(),
  }),
)

vi.mock('app/dashboard/shared/smsCutoff/useSmsCompliance', () => ({
  useSmsCompliance: vi.fn(),
}))
const mockUseSmsCompliance = vi.mocked(useSmsCompliance)

const submittedTcr = { status: 'submitted' } as TcrCompliance

const mockTrackEvent = vi.mocked(trackEvent)

const campaign = (isPro: boolean): Campaign =>
  ({ id: 1, isPro }) as unknown as Campaign

const exit = vi.fn()
const complete = vi.fn()

// The shell owns where Continue goes, so the step is exercised through the
// wizard context both shells provide.
const withWizard = (
  ui: React.ReactNode,
  overrides: Partial<ProUpgradeWizardContextValue> = {},
): React.JSX.Element => (
  <ProUpgradeWizardContext.Provider
    value={{
      currentStep: PRO_UPGRADE_STEP.SUCCESS,
      channel: null,
      goToStep: vi.fn(),
      goToNextStep: vi.fn(),
      goToPreviousStep: vi.fn(),
      exit,
      complete,
      ...overrides,
    }}
  >
    {ui}
  </ProUpgradeWizardContext.Provider>
)

describe('SuccessStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The screen polls the campaign query while waiting for the webhook to flip
    // isPro; default the fetch to the not-yet-Pro state so individual tests can
    // override it.
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign(false) })
    // No subscription on record until the webhook lands; the receipt card
    // draws nothing on a 404.
    api.mock('GET /v1/payments/purchase/pro-receipt', {
      status: 404,
      data: {},
    })
    mockGetTcrCompliance.mockResolvedValue(null)
    mockUseSmsCompliance.mockReturnValue({
      smsCompliance: 'open',
      smsCutoffDate: null,
      generalElectionDate: null,
    })
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

    render(withWizard(<SuccessStep />))

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

      render(withWizard(<SuccessStep />))

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

  it('lists what Pro unlocked and completes the flow from the verification CTA', async () => {
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign(true) })

    render(withWizard(<SuccessStep />))

    expect(
      await screen.findByRole('heading', { name: 'Welcome to Pro' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Your payment went through. One step left before you can send.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Unlocked now')).toBeInTheDocument()
    expect(
      screen.getByText('Individual voter records for your race'),
    ).toBeInTheDocument()
    // The standalone page has no channel and still hands off to verification.
    expect(screen.getByText('Still to do: verification')).toBeInTheDocument()

    const continueButton = screen.getByRole('button', {
      name: 'Start verification',
    })
    await waitFor(() => expect(continueButton).toBeEnabled())
    continueButton.click()

    expect(complete).toHaveBeenCalledTimes(1)
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.SuccessContinue,
    )
  })

  it('points a robocall candidate at their next outreach step instead', async () => {
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign(true) })

    render(
      withWizard(<SuccessStep />, {
        channel: 'robocall',
      }),
    )

    expect(
      screen.getByText(
        'Payment successful. Your next step is to schedule your robocall.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Still to do: schedule your robocall'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Pick a date and time, review the cost, and pay for the calls.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Still to do: verification'),
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    )
  })

  it('points a texting candidate at verification', async () => {
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign(true) })

    render(withWizard(<SuccessStep />, { channel: 'sms' }))

    expect(
      await screen.findByText('Still to do: verification'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Start verification' }),
      ).toBeEnabled(),
    )
  })

  it('shows the receipt once Pro lands, with the charge and card behind a toggle', async () => {
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign(true) })
    api.mock('GET /v1/payments/purchase/pro-receipt', {
      status: 200,
      data: {
        amount: 10,
        cardBrand: 'visa',
        cardLast4: '4242',
        receiptUrl: 'https://stripe.test/invoice.pdf',
        paidAt: new Date().toISOString(),
      },
    })
    const user = userEvent.setup()

    render(withWizard(<SuccessStep />))

    const toggle = await screen.findByRole('button', {
      name: /Your receipt/,
    })
    expect(toggle).toHaveTextContent('$10.00')
    expect(screen.queryByText('Charged today')).not.toBeInTheDocument()

    await user.click(toggle)

    expect(screen.getByText('Charged today')).toBeInTheDocument()
    expect(
      screen.getByText('Pro subscription, recurring monthly'),
    ).toBeInTheDocument()
    expect(screen.getByText('Visa •••• 4242')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Download receipt' }),
    ).toBeInTheDocument()
  })

  it('draws no receipt while the subscription is not on record yet', async () => {
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign(true) })

    render(withWizard(<SuccessStep />))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Start verification' }),
      ).toBeEnabled(),
    )
    expect(screen.queryByText('Your receipt')).not.toBeInTheDocument()
  })

  it('holds the hand-off CTA until the webhook flips isPro', async () => {
    // Campaign verification reads the Pro state this screen asserts, so
    // handing off before the flip lands would show a non-Pro surface.
    api.mockOrdered('GET /v1/campaigns/mine', [
      { status: 200, data: campaign(false) },
      { status: 200, data: campaign(true) },
    ])

    render(withWizard(<SuccessStep />))

    const continueButton = await screen.findByRole('button', {
      name: 'Start verification',
    })
    expect(continueButton).toBeDisabled()

    await waitFor(() => expect(continueButton).toBeEnabled(), {
      timeout: 5000,
    })
    expect(complete).not.toHaveBeenCalled()
  })

  // The wizard collects the filing before payment now, so a candidate who
  // just walked it has nothing left to start. The notice is the same one
  // campaign verification shows once a filing is in, and never a PIN box.
  it('confirms a filing already submitted and returns to the dashboard', async () => {
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign(true) })
    mockGetTcrCompliance.mockResolvedValue(submittedTcr)

    render(withWizard(<SuccessStep />))

    expect(
      await screen.findByText(
        'Your campaign has been submitted for verification.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('A PIN is on its way')).toBeInTheDocument()
    expect(
      screen.queryByText('Still to do: verification'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Start verification' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Finish later' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    const done = screen.getByRole('button', { name: 'Done' })
    await waitFor(() => expect(done).toBeEnabled())
    done.click()

    expect(exit).toHaveBeenCalledTimes(1)
    expect(complete).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.SuccessContinue,
    )
  })

  // Inside an outreach flow the gate decides what comes after the upgrade,
  // so the confirmation hands back to it rather than leaving the flow.
  it('hands a texting flow back to its gate once the filing is in', async () => {
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign(true) })
    mockGetTcrCompliance.mockResolvedValue(submittedTcr)

    render(withWizard(<SuccessStep />, { channel: 'sms' }))

    expect(await screen.findByText('A PIN is on its way')).toBeInTheDocument()
    const continueButton = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(continueButton).toBeEnabled())
    continueButton.click()

    expect(complete).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })

  // An already-Pro candidate who never got a filing through is routed here
  // by the entry, and this is the screen that sends them on to finish it.
  it('keeps the verification hand-off for a filing that was rejected', async () => {
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign(true) })
    mockGetTcrCompliance.mockResolvedValue({
      status: 'rejected',
    } as TcrCompliance)

    render(withWizard(<SuccessStep />))

    expect(
      await screen.findByText('Still to do: verification'),
    ).toBeInTheDocument()
    expect(screen.queryByText('A PIN is on its way')).not.toBeInTheDocument()
  })

  // A draft lives in this browser only; nothing reached gp-api, so the
  // candidate still has verification ahead of them.
  it('does not read an unsubmitted verification draft as a filing', async () => {
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign(true) })
    saveVerificationDraft(1, { filing: { candidateName: 'Jane Smith' } })

    render(withWizard(<SuccessStep />))

    expect(
      await screen.findByText('Still to do: verification'),
    ).toBeInTheDocument()
    expect(screen.queryByText('A PIN is on its way')).not.toBeInTheDocument()
    window.localStorage.clear()
  })

  it('does not read the filing for a channel with no verification step', () => {
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign(true) })
    mockGetTcrCompliance.mockResolvedValue(submittedTcr)

    render(withWizard(<SuccessStep />, { channel: 'door' }))

    expect(
      screen.getByText('Still to do: build your walk list'),
    ).toBeInTheDocument()
    expect(mockGetTcrCompliance).not.toHaveBeenCalled()
  })

  describe('with the SMS compliance window closed', () => {
    beforeEach(() => {
      mockUseSmsCompliance.mockReturnValue({
        smsCompliance: 'closed',
        smsCutoffDate: '2026-10-15',
        generalElectionDate: '2026-11-03',
      })
    })

    // Closed wins over the filing: saved details without a kickoff never
    // started verification, so there is no PIN coming either.
    it.each([
      ['no filing', null],
      ['a saved filing', submittedTcr],
    ])(
      'swaps verification for a closed banner and goes to the dashboard (%s)',
      async (_label, tcr) => {
        api.mock('GET /v1/campaigns/mine', {
          status: 200,
          data: campaign(true),
        })
        mockGetTcrCompliance.mockResolvedValue(tcr)

        render(withWizard(<SuccessStep />))

        expect(
          screen.getByText('Your payment went through.'),
        ).toBeInTheDocument()
        expect(screen.getByRole('alert')).toHaveTextContent(
          `The ${formatSmsCutoffDate('2026-10-15')} deadline to get verified for texting has passed.`,
        )
        expect(
          screen.queryByText('Still to do: verification'),
        ).not.toBeInTheDocument()
        expect(
          screen.queryByText('A PIN is on its way'),
        ).not.toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'Start verification' }),
        ).not.toBeInTheDocument()
        expect(mockGetTcrCompliance).not.toHaveBeenCalled()

        const goToDashboard = screen.getByRole('button', {
          name: 'Go to dashboard',
        })
        await waitFor(() => expect(goToDashboard).toBeEnabled())
        goToDashboard.click()

        expect(complete).toHaveBeenCalledTimes(1)
        expect(exit).not.toHaveBeenCalled()
      },
    )

    it('keeps a robocall launch on its next outreach step', () => {
      render(
        withWizard(<SuccessStep />, {
          channel: 'robocall',
        }),
      )

      expect(
        screen.getByText('Still to do: schedule your robocall'),
      ).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})

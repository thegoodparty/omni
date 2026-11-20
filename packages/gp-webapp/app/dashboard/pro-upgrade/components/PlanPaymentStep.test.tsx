import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { mswServer } from 'helpers/test-utils/api-mocking'
import { PRO_UPGRADE_STEP } from '../proUpgradeStep'
import PaymentStep from './PaymentStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'
import { useProUpgradeCarry } from './proUpgradeCarryContext'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'

const { confirmMock, checkoutValue, flag } = vi.hoisted(() => {
  const confirmMock = vi.fn()
  return {
    confirmMock,
    flag: { ready: true, enabled: true },
    checkoutValue: {
      confirm: confirmMock,
      canConfirm: true,
      total: {
        total: { minorUnitsAmount: 29900 },
        subtotal: { minorUnitsAmount: 29900 },
      },
      discountAmounts: undefined,
      applyPromotionCode: vi.fn(),
      removePromotionCode: vi.fn(),
    },
  }
})

vi.mock('app/shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => flag,
}))
vi.mock('./ProUpgradeWizard', () => ({ useProUpgradeWizard: vi.fn() }))
vi.mock('./proUpgradeCarryContext', () => ({ useProUpgradeCarry: vi.fn() }))
vi.mock('app/dashboard/shared/membership/deriveMembershipState', () => ({
  usePlan: vi.fn(),
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ id: 42 }],
}))
vi.mock('app/dashboard/shared/smsCutoff/useSmsCompliance', () => ({
  useSmsCompliance: vi.fn(),
}))
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  CheckoutProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useCheckout: () => ({ type: 'success', checkout: checkoutValue }),
  PaymentElement: () => <div data-testid="payment-element" />,
}))
vi.mock('@shared/utils/Snackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))
vi.mock('@shared/observability/reportClientError', () => ({
  reportClientError: vi.fn(),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const CREATE_URL = '/api/v1/payments/purchase/create-checkout-session'
const COMPLETE_URL = '/api/v1/payments/purchase/complete-checkout-session'
const SUBSCRIPTION_URL = '/api/v1/payments/purchase/checkout-session'

const goToStep = vi.fn()
const markFromPro = vi.fn()

const setup = ({
  plan,
  held,
}: {
  plan: 'pro' | 'team' | null
  held: 'free' | 'pro'
}): void => {
  vi.mocked(useProUpgradeWizard).mockReturnValue({
    currentStep: 'payment',
    channel: null,
    goToStep,
    goToNextStep: vi.fn(),
    goToPreviousStep: vi.fn(),
    exit: vi.fn(),
    complete: vi.fn(),
  })
  vi.mocked(useProUpgradeCarry).mockReturnValue({
    plan,
    returnTo: null,
    fromPro: false,
    markFromPro,
  })
  vi.mocked(usePlan).mockReturnValue({
    plan: held,
    isPaid: held !== 'free',
    onSubscription: false,
    planEndsAt: null,
    creditCents: 0,
    recommendTeam: false,
  })
}

describe('PaymentStep with per-campaign pricing on', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmMock.mockResolvedValue({ type: 'success' })
    checkoutValue.total.total.minorUnitsAmount = 29900
    vi.mocked(useSmsCompliance).mockReturnValue({
      smsCompliance: 'open',
      smsCutoffDate: null,
      generalElectionDate: null,
    })
  })

  it('creates a PLAN session for the campaign and never touches the subscription session', async () => {
    setup({ plan: 'pro', held: 'free' })
    let body: Record<string, unknown> | undefined
    let subscriptionHits = 0
    mswServer.use(
      http.post(CREATE_URL, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 'cs_1',
          clientSecret: 'cs_1_secret_x',
          amount: 299,
        })
      }),
      http.post(SUBSCRIPTION_URL, () => {
        subscriptionHits += 1
        return HttpResponse.json({}, { status: 410 })
      }),
    )

    render(<PaymentStep />)

    expect(
      await screen.findByRole('button', { name: 'Pay $299' }),
    ).toBeInTheDocument()
    expect(body).toMatchObject({
      type: 'PLAN',
      metadata: { campaignId: 42, plan: 'pro' },
    })
    expect(subscriptionHits).toBe(0)
    expect(screen.getByText('Pro is $299 per campaign.')).toBeInTheDocument()
    expect(
      screen.getByText('Pro plan with $175 outreach credit'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/no subscription/i)).not.toBeInTheDocument()
  })

  it('shows the Pro to Team breakdown and charges the difference', async () => {
    setup({ plan: 'team', held: 'pro' })
    checkoutValue.total.total.minorUnitsAmount = 10000
    mswServer.use(
      http.post(CREATE_URL, () =>
        HttpResponse.json({ id: 'cs_2', clientSecret: 'cs_2_secret_x' }),
      ),
    )

    render(<PaymentStep />)

    expect(
      await screen.findByRole('button', { name: 'Pay $100' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('You only pay the difference from Pro.'),
    ).toBeInTheDocument()
    expect(screen.getByText('$399.00')).toBeInTheDocument()
    expect(screen.getByText('Pro, already paid')).toBeInTheDocument()
    expect(screen.getByText('−$299.00')).toBeInTheDocument()
    expect(screen.getByText('$100.00')).toBeInTheDocument()
  })

  it('completes the session and goes to success, marking a Pro to Team upgrade', async () => {
    setup({ plan: 'team', held: 'pro' })
    let completed: unknown
    mswServer.use(
      http.post(CREATE_URL, () =>
        HttpResponse.json({ id: 'cs_3', clientSecret: 'cs_3_secret_x' }),
      ),
      http.post(COMPLETE_URL, async ({ request }) => {
        completed = await request.json()
        return HttpResponse.json({ success: true })
      }),
    )

    render(<PaymentStep />)
    fireEvent.click(await screen.findByRole('button', { name: /^Pay / }))

    await waitFor(() =>
      expect(goToStep).toHaveBeenCalledWith(PRO_UPGRADE_STEP.SUCCESS),
    )
    expect(completed).toEqual({ checkoutSessionId: 'cs_3' })
    expect(markFromPro).toHaveBeenCalled()
  })

  it.each([
    ['ALREADY_ON_PLAN', 409, 'Your campaign already has this plan.'],
    [
      'NOT_CAMPAIGN_OWNER',
      403,
      'Only the campaign owner can change the plan. Ask the owner to upgrade.',
    ],
  ])('shows %s inline instead of crashing', async (errorCode, status, text) => {
    setup({ plan: 'pro', held: 'free' })
    mswServer.use(
      http.post(CREATE_URL, () =>
        HttpResponse.json({ errorCode, message: 'no' }, { status }),
      ),
    )

    render(<PaymentStep />)

    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(goToStep).not.toHaveBeenCalled()
  })
})

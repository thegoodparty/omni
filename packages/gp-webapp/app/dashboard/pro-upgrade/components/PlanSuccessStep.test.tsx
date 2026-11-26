import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import type { Campaign } from 'helpers/types'
import { PRO_UPGRADE_STEP } from '../proUpgradeStep'
import {
  ProUpgradeWizardContext,
  type ProUpgradeWizardContextValue,
} from './proUpgradeWizardContext'
import { useProUpgradeCarry } from './proUpgradeCarryContext'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import SuccessStep from './SuccessStep'
import { PLAN_RECEIPT_QUERY_KEY } from './PlanReceiptCard'
import { PIN_NOTICE_BODY } from 'app/dashboard/campaign-verification/verificationCopy'

vi.mock('app/shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({ ready: true, enabled: true }),
}))
vi.mock('./proUpgradeCarryContext', () => ({ useProUpgradeCarry: vi.fn() }))
vi.mock('app/dashboard/shared/membership/deriveMembershipState', () => ({
  usePlan: vi.fn(),
}))
vi.mock('app/dashboard/shared/smsCutoff/useSmsCompliance', () => ({
  useSmsCompliance: vi.fn(),
}))
vi.mock('app/dashboard/questions/components/Confetti', () => ({
  default: () => null,
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
vi.mock(
  'app/dashboard/profile/texting-compliance/util/tcrCompliance.util',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('app/dashboard/profile/texting-compliance/util/tcrCompliance.util')
    >()),
    getTcrCompliance: () => Promise.resolve({ status: 'submitted' }),
  }),
)

const campaign = { id: 1, isPro: true } as unknown as Campaign

const wizard: ProUpgradeWizardContextValue = {
  currentStep: PRO_UPGRADE_STEP.SUCCESS,
  channel: null,
  goToStep: vi.fn(),
  goToNextStep: vi.fn(),
  goToPreviousStep: vi.fn(),
  exit: vi.fn(),
  complete: vi.fn(),
}

const setup = (
  plan: 'pro' | 'team',
  carry: { returnTo?: string | null; fromPro?: boolean } = {},
): void => {
  vi.mocked(useProUpgradeCarry).mockReturnValue({
    plan,
    returnTo: carry.returnTo ?? null,
    backTo: null,
    fromPro: carry.fromPro ?? false,
    markFromPro: vi.fn(),
  })
  vi.mocked(usePlan).mockReturnValue({
    plan,
    heldPlan: plan,
    isPaid: true,
    onSubscription: false,
    planEndsAt: null,
    creditCents: 17500,
    recommendTeam: false,
  })
}

const renderStep = (): void => {
  render(
    <ProUpgradeWizardContext.Provider value={wizard}>
      <SuccessStep />
    </ProUpgradeWizardContext.Provider>,
  )
}

describe('SuccessStep with per-campaign pricing on', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testQueryClient.setQueryData(CAMPAIGN_QUERY_KEY, campaign)
    api.mock('GET /v1/campaigns/mine', { status: 200, data: campaign })
    api.mock('GET /v1/payments/purchase/plan-receipt', {
      status: 200,
      data: {
        amountCents: 29900,
        paidAt: '2026-11-17T12:00:00.000Z',
        cardBrand: 'visa',
        cardLast4: '4242',
        paymentMethod: 'card',
        receiptUrl: null,
        planEndsAt: '2027-11-17T12:00:00.000Z',
      },
    })
    vi.mocked(useSmsCompliance).mockReturnValue({
      smsCompliance: 'open',
      smsCutoffDate: null,
      generalElectionDate: null,
    })
  })

  it('shows a one-time receipt with the card and the Good through date, and no per-month price', async () => {
    setup('pro')
    renderStep()

    fireEvent.click(await screen.findByRole('button', { name: /Your receipt/ }))

    expect(
      screen.getByText('$299.00', { selector: 'span.font-medium' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Pro plan with $175 outreach credit'),
    ).toBeInTheDocument()
    expect(screen.getByText('Visa •••• 4242')).toBeInTheDocument()
    expect(screen.getByText('Good through')).toBeInTheDocument()
    expect(screen.getByText('November 17, 2027')).toBeInTheDocument()
    expect(screen.queryByText(/\/mo/)).not.toBeInTheDocument()
  })

  it('draws no receipt and no error when a manager is refused the receipt', async () => {
    setup('pro')
    api.mock('GET /v1/payments/purchase/plan-receipt', {
      status: 403,
      data: { message: 'Organization owner access required' },
    })
    renderStep()

    expect(await screen.findByText('Welcome to Pro')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        testQueryClient.getQueryState(PLAN_RECEIPT_QUERY_KEY)?.status,
      ).toBe('error'),
    )
    expect(
      screen.queryByRole('button', { name: /Your receipt/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lists the outreach credit as a fourth unlocked row and keeps the PIN note plain', async () => {
    setup('pro')
    renderStep()

    expect(await screen.findByText('Welcome to Pro')).toBeInTheDocument()
    expect(screen.getByText('$175 outreach credit')).toBeInTheDocument()
    expect(screen.getByText(PIN_NOTICE_BODY)).toBeInTheDocument()
    expect(screen.queryByText(/and your \$175/)).not.toBeInTheDocument()
  })

  it('sends Done on the standalone confirmation to Voter Outreach', async () => {
    setup('pro')
    renderStep()

    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))

    expect(router.push).toHaveBeenCalledWith('/dashboard/outreach')
    expect(wizard.exit).not.toHaveBeenCalled()
  })

  it('hands back to the flow from Continue when the wizard was opened in a sheet', async () => {
    setup('pro')
    render(
      <ProUpgradeWizardContext.Provider value={{ ...wizard, channel: 'sms' }}>
        <SuccessStep />
      </ProUpgradeWizardContext.Provider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    expect(wizard.complete).toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('welcomes a Pro holder to Team with what stays, and invites the team at the Team Settings drawer', async () => {
    setup('team', { fromPro: true, returnTo: '/dashboard/team' })
    api.mock('GET /v1/payments/purchase/plan-receipt', {
      status: 200,
      data: {
        amountCents: 10000,
        paidAt: '2026-11-17T12:00:00.000Z',
        cardBrand: null,
        cardLast4: null,
        paymentMethod: null,
        receiptUrl: null,
        planEndsAt: '2027-11-17T12:00:00.000Z',
      },
    })
    renderStep()

    expect(await screen.findByText('Welcome to Team')).toBeInTheDocument()
    expect(screen.getByText('Logins for your team')).toBeInTheDocument()
    expect(screen.getByText('Everything from Pro stays')).toBeInTheDocument()
    expect(
      await screen.findByText(/Still good through November 17, 2027\./),
    ).toBeInTheDocument()
    expect(screen.queryByText('A PIN is on its way')).not.toBeInTheDocument()
    expect(screen.queryByText('$175 outreach credit')).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: /Your receipt/ }))
    expect(screen.getByText('Team plan upgrade')).toBeInTheDocument()
    expect(
      screen.queryByText(/with \$175 outreach credit/),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Invite your team' }))
    expect(router.push).toHaveBeenCalledWith('/dashboard/team?invite=1')
  })
})

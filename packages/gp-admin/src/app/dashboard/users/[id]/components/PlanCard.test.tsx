import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CampaignWithLiveContext } from '@/shared/gpApi'
import { PlanCard } from './PlanCard'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

const mockShowToast = vi.fn()
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

const mockSetPlan = vi.fn()
const mockExtend = vi.fn()
const mockRefund = vi.fn()
const mockEligibility = vi.fn()
vi.mock('@/app/dashboard/campaigns/planActions', () => ({
  setCampaignPlan: (...args: unknown[]) => mockSetPlan(...args),
  extendCampaignPlan: (...args: unknown[]) => mockExtend(...args),
  refundCampaignPlan: (...args: unknown[]) => mockRefund(...args),
  getRefundEligibility: (...args: unknown[]) => mockEligibility(...args),
}))

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000)

const eligible = (overrides: Record<string, unknown> = {}) => ({
  data: {
    refundable: true,
    reason: null,
    purchaseId: 1,
    kind: 'plan',
    amountCents: 29900,
    purchasedAt: daysAgo(3).toISOString(),
    daysSincePurchase: 3,
    outreachSent: false,
    ...overrides,
  },
  error: null,
})

const campaign = (overrides: Partial<CampaignWithLiveContext> = {}) =>
  ({
    id: 7,
    userId: 595,
    plan: 'pro',
    planPricingModel: 'one_time',
    planPaidAt: daysAgo(3),
    planEndsAt: new Date('2026-12-05T12:00:00Z'),
    planEndedAt: null,
    outreachCreditCents: 17500,
    details: {},
    ...overrides,
  }) as CampaignWithLiveContext

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.scrollIntoView = () => {}
  vi.clearAllMocks()
  mockEligibility.mockResolvedValue(eligible())
})

describe('PlanCard', () => {
  it('shows the plan, Good through and credit balance', () => {
    render(<PlanCard campaign={campaign()} />)

    expect(screen.getByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('One time')).toBeInTheDocument()
    expect(screen.getByText('Dec 5, 2026')).toBeInTheDocument()
    expect(screen.getByText('$175.00')).toBeInTheDocument()
  })

  it('shows no Good through date on Free', () => {
    render(<PlanCard campaign={campaign({ plan: 'free', planPaidAt: null })} />)

    expect(screen.getByText('Good through').nextSibling).toHaveTextContent('—')
  })

  it('comps a plan with a required reason and an optional credit', async () => {
    const ue = userEvent.setup()
    mockSetPlan.mockResolvedValue({ data: { plan: 'team' }, error: null })
    render(<PlanCard campaign={campaign()} />)

    await ue.click(screen.getByRole('button', { name: 'Change plan' }))
    const confirm = screen.getAllByRole('button', { name: 'Change plan' })[0]
    expect(confirm).toBeDisabled()

    await ue.click(screen.getByRole('combobox', { name: 'Plan' }))
    await ue.click(await screen.findByRole('option', { name: 'Team' }))
    await ue.type(screen.getByLabelText(/Outreach credit/), '50')
    await ue.type(screen.getByLabelText('Reason'), 'Partner comp')
    await ue.click(screen.getAllByRole('button', { name: 'Change plan' })[0])

    expect(mockSetPlan).toHaveBeenCalledWith(7, 595, {
      plan: 'team',
      creditCents: 5000,
      reason: 'Partner comp',
    })
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('shows the ACTIVE_SUBSCRIPTION refusal inline', async () => {
    const ue = userEvent.setup()
    mockSetPlan.mockResolvedValue({
      data: null,
      error: 'Cancel the Stripe subscription before setting Free',
    })
    render(<PlanCard campaign={campaign()} />)

    await ue.click(screen.getByRole('button', { name: 'Change plan' }))
    await ue.type(screen.getByLabelText('Reason'), 'Comp ended')
    await ue.click(screen.getAllByRole('button', { name: 'Change plan' })[0])

    expect(
      await screen.findByText(
        'Cancel the Stripe subscription before setting Free'
      )
    ).toBeInTheDocument()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('clears the end-date override with a reason', async () => {
    const ue = userEvent.setup()
    mockExtend.mockResolvedValue({ data: { plan: 'pro' }, error: null })
    render(<PlanCard campaign={campaign()} />)

    await ue.click(screen.getByRole('button', { name: 'Set end date' }))
    await ue.click(screen.getByLabelText('Clear the override'))
    await ue.type(screen.getByLabelText('Reason'), 'Back to election date')
    await ue.click(screen.getByRole('button', { name: 'Clear end date' }))

    expect(mockExtend).toHaveBeenCalledWith(7, 595, {
      endsAt: null,
      reason: 'Back to election date',
    })
  })

  it('sets an end-date override', async () => {
    const ue = userEvent.setup()
    mockExtend.mockResolvedValue({ data: { plan: 'pro' }, error: null })
    render(<PlanCard campaign={campaign()} />)

    await ue.click(screen.getByRole('button', { name: 'Set end date' }))
    await ue.type(screen.getByLabelText('Good through'), '2027-01-05')
    await ue.type(screen.getByLabelText('Reason'), 'Runoff')
    await ue.click(screen.getAllByRole('button', { name: 'Set end date' })[0])

    expect(mockExtend).toHaveBeenCalledWith(7, 595, {
      endsAt: '2027-01-05T23:59:59.000Z',
      reason: 'Runoff',
    })
  })

  it('shows days since purchase before refunding, then the outcome', async () => {
    const ue = userEvent.setup()
    mockRefund.mockResolvedValue({
      data: {
        refundedCents: 29900,
        eligibility: eligible({ outreachSent: true }).data,
      },
      error: null,
    })
    render(<PlanCard campaign={campaign()} />)

    await ue.click(screen.getByRole('button', { name: 'Refund' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      await within(dialog).findByText(/Bought 3 days ago/)
    ).toBeInTheDocument()
    expect(within(dialog).queryByText(/outside the refund window/)).toBeNull()

    await ue.click(within(dialog).getByRole('button', { name: 'Refund' }))

    expect(mockRefund).toHaveBeenCalledWith(7, 595)
    expect(mockShowToast).toHaveBeenCalledWith(
      'Refunded $299.00. 3 days since purchase, outreach was sent.'
    )
  })

  it('warns when the purchase is outside the refund window', async () => {
    const ue = userEvent.setup()
    mockEligibility.mockResolvedValue(eligible({ daysSincePurchase: 20 }))
    render(<PlanCard campaign={campaign()} />)

    await ue.click(screen.getByRole('button', { name: 'Refund' }))

    expect(
      await screen.findByText(/outside the refund window/)
    ).toBeInTheDocument()
  })

  it('says outreach was sent before staff confirm', async () => {
    const ue = userEvent.setup()
    mockEligibility.mockResolvedValue(eligible({ outreachSent: true }))
    render(<PlanCard campaign={campaign()} />)

    await ue.click(screen.getByRole('button', { name: 'Refund' }))

    expect(
      await screen.findByText(/Outreach was sent after this plan was bought/)
    ).toBeInTheDocument()
    expect(mockEligibility).toHaveBeenCalledWith(7)
  })

  it('says no outreach was sent', async () => {
    const ue = userEvent.setup()
    render(<PlanCard campaign={campaign()} />)

    await ue.click(screen.getByRole('button', { name: 'Refund' }))

    expect(
      await screen.findByText(/No outreach sent since this plan was bought/)
    ).toBeInTheDocument()
  })

  it('explains and blocks a refund that is not refundable', async () => {
    const ue = userEvent.setup()
    mockEligibility.mockResolvedValue(
      eligible({ refundable: false, reason: 'ACTIVE_SUBSCRIPTION' })
    )
    render(<PlanCard campaign={campaign()} />)

    await ue.click(screen.getByRole('button', { name: 'Refund' }))
    const dialog = await screen.findByRole('alertdialog')

    expect(
      await within(dialog).findByText(/Cancel the Stripe subscription/)
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Refund' })
    ).toBeDisabled()
  })

  it('blocks the refund when eligibility cannot be loaded', async () => {
    const ue = userEvent.setup()
    mockEligibility.mockResolvedValue({ data: null, error: 'No campaign' })
    render(<PlanCard campaign={campaign()} />)

    await ue.click(screen.getByRole('button', { name: 'Refund' }))
    const dialog = await screen.findByRole('alertdialog')

    expect(await within(dialog).findByText('No campaign')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Refund' })
    ).toBeDisabled()
  })

  it('shows a refused refund inline', async () => {
    const ue = userEvent.setup()
    mockRefund.mockResolvedValue({
      data: null,
      error: 'Cancel the Stripe subscription before refunding this plan',
    })
    render(<PlanCard campaign={campaign()} />)

    await ue.click(screen.getByRole('button', { name: 'Refund' }))
    const dialog = await screen.findByRole('alertdialog')
    await ue.click(within(dialog).getByRole('button', { name: 'Refund' }))

    expect(
      await within(dialog).findByText(
        'Cancel the Stripe subscription before refunding this plan'
      )
    ).toBeInTheDocument()
  })
})

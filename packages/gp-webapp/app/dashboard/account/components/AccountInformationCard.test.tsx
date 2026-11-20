import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { User } from 'helpers/types'
import { AccountInformationCard } from './AccountInformationCard'

const { mockCampaign, mockFlag, mockRole, mockClientFetch } = vi.hoisted(
  () => ({
    mockCampaign: vi.fn(),
    mockFlag: vi.fn(),
    mockRole: vi.fn(),
    mockClientFetch: vi.fn(),
  }),
)

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [mockCampaign()],
}))
vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => mockFlag(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganizationRole: () => mockRole(),
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn() }),
}))
vi.mock('gpApi/clientFetch', () => ({ clientFetch: mockClientFetch }))

const user = {
  id: 1,
  createdAt: '2024-01-01',
  metaData: { customerId: 'cus_1' },
} as unknown as User

const renderCard = (isPro: boolean, subscriptionId: string | null = null) =>
  render(
    <AccountInformationCard
      user={user}
      isPro={isPro}
      isElectedOffice={false}
      subscriptionId={subscriptionId}
    />,
  )

describe('AccountInformationCard plans', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlag.mockReturnValue({ enabled: true })
    mockRole.mockReturnValue('owner')
  })

  it('shows a one-time Pro owner the plan, Good through, Team upgrade and Billing history', async () => {
    mockCampaign.mockReturnValue({
      isPro: true,
      plan: 'pro',
      planPricingModel: 'one_time',
      planEndsAt: '2026-11-17T12:00:00.000Z',
    })
    renderCard(true)

    expect(screen.getByText('GoodParty.org Pro Plan')).toBeInTheDocument()
    expect(screen.getByText('Nov 17, 2026')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Billing history/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Manage Subscription/ }),
    ).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Upgrade to Team for $100' })
    expect(link).toHaveAttribute('href', expect.stringContaining('plan=team'))
    expect(link.getAttribute('href')).toContain(
      '/dashboard/pro-upgrade?source=navigation&channel=generic&cta=',
    )

    await userEvent.click(screen.getByText('Why this date?'))
    expect(
      await screen.findByText(/this date moves if the election moves/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Contact us' })).toBeInTheDocument()
  })

  it('opens the billing portal from Billing history', async () => {
    mockClientFetch.mockResolvedValue({ data: {} })
    mockCampaign.mockReturnValue({
      isPro: true,
      plan: 'pro',
      planPricingModel: 'one_time',
      planEndsAt: null,
    })
    renderCard(true)
    await userEvent.click(
      screen.getByRole('button', { name: /Billing history/ }),
    )
    expect(mockClientFetch).toHaveBeenCalledTimes(1)
  })

  it('shows a Team owner the Team plan with no Team upgrade', () => {
    mockCampaign.mockReturnValue({
      isPro: true,
      plan: 'team',
      planPricingModel: 'one_time',
      planEndsAt: '2026-11-17T12:00:00.000Z',
    })
    renderCard(true)

    expect(screen.getByText('GoodParty.org Team Plan')).toBeInTheDocument()
    expect(screen.getByText('Nov 17, 2026')).toBeInTheDocument()
    expect(screen.queryByText(/Upgrade to Team/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Manage Subscription/ }),
    ).not.toBeInTheDocument()
  })

  it('hides the Team upgrade from non-owners', () => {
    mockRole.mockReturnValue('campaignAdmin')
    mockCampaign.mockReturnValue({
      isPro: true,
      plan: 'pro',
      planPricingModel: 'one_time',
      planEndsAt: null,
    })
    renderCard(true)
    expect(screen.queryByText(/Upgrade to Team/)).not.toBeInTheDocument()
  })

  it('keeps a grandfathered subscriber on the subscription label and Manage Subscription', () => {
    mockCampaign.mockReturnValue({
      isPro: true,
      plan: 'pro',
      planPricingModel: 'subscription',
      planEndsAt: null,
    })
    renderCard(true, 'sub_1')
    expect(
      screen.getByText('GoodParty.org Pro Plan - $10/month'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Manage Subscription/ }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Good through')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$299/)).not.toBeInTheDocument()
  })

  it('shows a Free campaign Free and a link to the plans page', () => {
    mockCampaign.mockReturnValue({ isPro: false, plan: 'free' })
    renderCard(false)
    expect(screen.getByText('GoodParty.org Free Plan')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      '/dashboard/plans',
    )
  })

  it("leaves today's copy with the flag off", () => {
    mockFlag.mockReturnValue({ enabled: false })
    mockCampaign.mockReturnValue({ isPro: false, plan: 'free' })
    renderCard(false)
    expect(
      screen.getByText('GoodParty.org Base Plan - Free'),
    ).toBeInTheDocument()
  })
})

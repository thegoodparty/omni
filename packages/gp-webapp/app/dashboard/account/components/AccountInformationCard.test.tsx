import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
vi.mock('app/dashboard/shared/membership/ProPitchDialog', () => ({
  ProPitchDialog: ({
    open,
    source,
    invite,
  }: {
    open: boolean
    source: string
    invite?: boolean
  }) =>
    open ? (
      <div role="dialog" data-source={source} data-invite={String(!!invite)}>
        Team cross-sell
      </div>
    ) : null,
}))

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

  it('shows a one-time Pro owner compact rows, Good through and the Team link', async () => {
    mockCampaign.mockReturnValue({
      isPro: true,
      plan: 'pro',
      planPricingModel: 'one_time',
      planEndsAt: '2027-11-17T12:00:00.000Z',
      outreachCreditCents: 17500,
    })
    renderCard(true)

    expect(screen.getByText('Account type')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'PRO' })).toBeInTheDocument()
    expect(screen.getByText(/Need team logins\?/)).toBeInTheDocument()
    expect(screen.getByText('Good through')).toBeInTheDocument()
    expect(screen.getByText('November 17, 2027')).toBeInTheDocument()
    expect(screen.queryByText('$299')).not.toBeInTheDocument()
    expect(screen.queryByText(/One payment/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Outreach credit/)).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Account information' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Billing history/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Manage Subscription/ }),
    ).not.toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'How this date is set' }),
    )
    expect(
      await screen.findByText(/Your plan lasts until 2 weeks after/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Contact support' }),
    ).toHaveAttribute('href', expect.stringMatching(/^mailto:/))
  })

  it('opens the Team cross-sell from Upgrade for $100', async () => {
    mockCampaign.mockReturnValue({
      isPro: true,
      plan: 'pro',
      planPricingModel: 'one_time',
      planEndsAt: null,
    })
    renderCard(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Upgrade for $100' }),
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('data-source', 'account_settings')
    expect(dialog).toHaveAttribute('data-invite', 'true')
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

    expect(screen.getByRole('img', { name: 'TEAM' })).toBeInTheDocument()
    expect(screen.getByText('November 17, 2026')).toBeInTheDocument()
    expect(screen.queryByText(/Need team logins/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Upgrade for/)).not.toBeInTheDocument()
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
    expect(screen.queryByText(/Need team logins/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Upgrade for/)).not.toBeInTheDocument()
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
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('$0')).toBeInTheDocument()
    expect(screen.getByText(/From \$299, one payment/)).toBeInTheDocument()
    expect(screen.getByText('$175 outreach credit')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      '/dashboard/plans',
    )
  })

  describe('dates are the same in every timezone', () => {
    const originalTz = process.env.TZ
    afterEach(() => {
      process.env.TZ = originalTz
    })

    it.each(['America/Los_Angeles', 'Asia/Tokyo'])(
      'renders Good through and Joined as the UTC date in %s',
      (tz) => {
        process.env.TZ = tz
        mockCampaign.mockReturnValue({
          isPro: true,
          plan: 'pro',
          planPricingModel: 'one_time',
          planEndsAt: '2027-01-30T00:00:00.000Z',
        })
        render(
          <AccountInformationCard
            user={{ ...user, createdAt: '2024-02-01T00:00:00.000Z' } as User}
            isPro
            isElectedOffice={false}
          />,
        )
        expect(screen.getByText('January 29, 2027')).toBeInTheDocument()
        expect(screen.getByText('February 2024')).toBeInTheDocument()
      },
    )
  })

  it("leaves today's copy with the flag off", () => {
    mockFlag.mockReturnValue({ enabled: false })
    mockCampaign.mockReturnValue({ isPro: false, plan: 'free' })
    renderCard(false)
    expect(
      screen.getByText('GoodParty.org Base Plan - Free'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Account Information' }),
    ).toBeInTheDocument()
  })
})

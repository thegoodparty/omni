import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { useQuery } from '@tanstack/react-query'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { ELIGIBILITY_QUERY_KEY } from '@shared/organization-picker'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
import ProUpgradeEntry from './ProUpgradeEntry'
import { useProUpgradeCarry } from './proUpgradeCarryContext'

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: vi.fn(),
}))
vi.mock('app/shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({ ready: true, enabled: true }),
}))
vi.mock('./proUpgradeCarryContext', () => ({ useProUpgradeCarry: vi.fn() }))
vi.mock('app/dashboard/shared/membership/deriveMembershipState', () => ({
  usePlan: vi.fn(),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const result = (data: unknown) =>
  ({
    data,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }) as unknown as ReturnType<typeof useQuery>

const setup = (
  plan: 'free' | 'pro',
  carry: { plan: 'pro' | 'team' | null; returnTo: string | null },
): void => {
  vi.mocked(useQuery).mockImplementation((options) => {
    const { queryKey } = options as { queryKey: unknown }
    if (queryKey === CAMPAIGN_QUERY_KEY) {
      return result({ isPro: plan === 'pro' })
    }
    if (queryKey === ELIGIBILITY_QUERY_KEY) {
      return result({ hasActiveCampaign: true })
    }
    return result(null)
  })
  vi.mocked(usePlan).mockReturnValue({
    plan,
    isPaid: plan !== 'free',
    onSubscription: false,
    planEndsAt: null,
    creditCents: 0,
    recommendTeam: false,
  })
  vi.mocked(useProUpgradeCarry).mockReturnValue({
    ...carry,
    backTo: null,
    fromPro: false,
    markFromPro: vi.fn(),
  })
}

describe('ProUpgradeEntry with a plan in the URL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends a Pro campaign asking for Team straight to payment, keeping the plan', () => {
    setup('pro', { plan: 'team', returnTo: '/dashboard/team' })

    render(<ProUpgradeEntry />)

    expect(router.replace).toHaveBeenCalledWith(
      '/dashboard/pro-upgrade/payment?plan=team&returnTo=%2Fdashboard%2Fteam',
    )
  })

  it('walks a Free campaign asking for Team through the whole wizard, keeping the plan', () => {
    setup('free', { plan: 'team', returnTo: null })

    render(<ProUpgradeEntry />)

    expect(router.replace).toHaveBeenCalledWith(
      '/dashboard/pro-upgrade/guidance?plan=team',
    )
  })
})

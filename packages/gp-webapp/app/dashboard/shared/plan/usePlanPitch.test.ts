import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useContextualPlanPitch, usePlanPitch } from './usePlanPitch'

vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({ ready: true, enabled: true }),
}))

vi.mock('app/dashboard/shared/membership/deriveMembershipState', () => ({
  usePlan: () => ({ recommendTeam: true }),
}))

describe('plan pitch hooks on a race that recommends Team', () => {
  it('usePlanPitch pitches Team', () => {
    const { result } = renderHook(() => usePlanPitch())

    expect(result.current).toMatchObject({
      plan: 'team',
      price: '$399',
      allPlansHref: '/dashboard/plans?highlight=team',
    })
  })

  it('useContextualPlanPitch always pitches Pro', () => {
    const { result } = renderHook(() => useContextualPlanPitch())

    expect(result.current).toMatchObject({
      enabled: true,
      plan: 'pro',
      price: '$299',
      allPlansHref: '/dashboard/plans',
    })
  })
})

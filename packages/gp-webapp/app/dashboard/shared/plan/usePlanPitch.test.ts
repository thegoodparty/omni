import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useContextualPlanPitch, usePlanPitch } from './usePlanPitch'

const { mockPathname } = vi.hoisted(() => ({ mockPathname: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname() }))

vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({ ready: true, enabled: true }),
}))

vi.mock('app/dashboard/shared/membership/deriveMembershipState', () => ({
  usePlan: () => ({ recommendTeam: true }),
}))

describe('plan pitch hooks on a race that recommends Team', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/dashboard')
  })

  it('usePlanPitch pitches Team', () => {
    const { result } = renderHook(() => usePlanPitch())

    expect(result.current).toMatchObject({
      plan: 'team',
      price: '$399',
      allPlansHref: '/dashboard/plans?highlight=team&backTo=%2Fdashboard',
    })
  })

  it('useContextualPlanPitch always pitches Pro', () => {
    const { result } = renderHook(() => useContextualPlanPitch())

    expect(result.current).toMatchObject({
      enabled: true,
      plan: 'pro',
      price: '$299',
      allPlansHref: '/dashboard/plans?backTo=%2Fdashboard',
    })
  })

  it.each([
    '/dashboard/race-opponent',
    '/dashboard/contacts',
    '/dashboard/outreach',
    '/dashboard/team',
  ])('sends Back on the plans page to %s, the page the pitch is on', (path) => {
    mockPathname.mockReturnValue(path)
    const { result } = renderHook(() => useContextualPlanPitch())

    expect(result.current.allPlansHref).toBe(
      `/dashboard/plans?backTo=${encodeURIComponent(path)}`,
    )
  })

  it('leaves backTo off a page Back cannot return to', () => {
    mockPathname.mockReturnValue('/dashboard/door-knocking')
    const { result } = renderHook(() => useContextualPlanPitch())

    expect(result.current.allPlansHref).toBe('/dashboard/plans')
  })
})

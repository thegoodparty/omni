import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import { usePlan } from './deriveMembershipState'

const { mockUseCampaign } = vi.hoisted(() => ({ mockUseCampaign: vi.fn() }))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => mockUseCampaign(),
}))

const planFor = (campaign: object | null) => {
  mockUseCampaign.mockReturnValue([campaign])
  return renderHook(() => usePlan()).result.current
}

describe('usePlan', () => {
  it('reads a free campaign with no credit', () => {
    expect(planFor({ plan: 'free', isPro: false })).toEqual({
      plan: 'free',
      isPaid: false,
      onSubscription: false,
      planEndsAt: null,
      creditCents: 0,
      recommendTeam: false,
    })
  })

  it('reads the plan columns for a paid campaign', () => {
    const state = planFor({
      plan: 'team',
      isPro: true,
      planEndsAt: '2026-12-01T00:00:00.000Z',
      outreachCreditCents: 17500,
    })
    expect(state.plan).toBe('team')
    expect(state.isPaid).toBe(true)
    expect(state.planEndsAt).toEqual(new Date('2026-12-01T00:00:00.000Z'))
    expect(state.creditCents).toBe(17500)
  })

  it('treats a legacy Pro campaign whose plan column still reads free as pro', () => {
    expect(planFor({ plan: 'free', isPro: true })).toMatchObject({
      plan: 'pro',
      isPaid: true,
    })
  })

  it('reads a legacy subscriber as pro, and as a subscriber once stamped', () => {
    expect(
      planFor({ plan: 'free', isPro: true, planPricingModel: null }),
    ).toMatchObject({ plan: 'pro', isPaid: true, onSubscription: false })
    expect(
      planFor({ plan: 'pro', isPro: true, planPricingModel: 'subscription' }),
    ).toMatchObject({ plan: 'pro', isPaid: true, onSubscription: true })
    expect(
      planFor({ plan: 'pro', isPro: true, planPricingModel: 'one_time' })
        .onSubscription,
    ).toBe(false)
  })

  it('has no plan state without a campaign', () => {
    expect(planFor(null)).toMatchObject({ plan: 'free', isPaid: false })
  })

  it('recommends Team only above the voter threshold', () => {
    const at = PLAN_PRICING.teamRecommendVoterThreshold
    expect(
      planFor({ raceTargetMetrics: { registeredVoters: at } }).recommendTeam,
    ).toBe(false)
    expect(
      planFor({ raceTargetMetrics: { registeredVoters: at + 1 } })
        .recommendTeam,
    ).toBe(true)
  })

  it('falls back to Pro when the voter count is missing', () => {
    expect(planFor({ raceTargetMetrics: {} }).recommendTeam).toBe(false)
    expect(
      planFor({ raceTargetMetrics: { registeredVoters: null } }).recommendTeam,
    ).toBe(false)
  })
})

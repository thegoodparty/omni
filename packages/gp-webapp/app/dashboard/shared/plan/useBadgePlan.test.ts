import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBadgePlan } from './useBadgePlan'

const { mockUseCampaign, mockFlag } = vi.hoisted(() => ({
  mockUseCampaign: vi.fn(),
  mockFlag: { enabled: true },
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => mockUseCampaign(),
}))
vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => mockFlag,
}))

const badgeFor = (campaign: object | null) => {
  mockUseCampaign.mockReturnValue([campaign])
  return renderHook(() => useBadgePlan()).result.current
}

describe('useBadgePlan', () => {
  beforeEach(() => {
    mockFlag.enabled = true
  })

  it('follows the plan with the flag on', () => {
    expect(badgeFor({ plan: 'free', isPro: false })).toBe('free')
    expect(badgeFor({ plan: 'pro', isPro: true })).toBe('pro')
    expect(badgeFor({ plan: 'team', isPro: true })).toBe('team')
  })

  it('shows no badge once the plan has ended', () => {
    expect(
      badgeFor({
        plan: 'team',
        isPro: false,
        planEndedAt: '2026-11-01T00:00:00.000Z',
      }),
    ).toBe('free')
  })

  it('keeps a legacy subscriber on pro', () => {
    expect(
      badgeFor({
        plan: 'free',
        isPro: true,
        planPricingModel: 'subscription',
      }),
    ).toBe('pro')
  })

  it('reads isPro with the flag off', () => {
    mockFlag.enabled = false
    expect(badgeFor({ plan: 'team', isPro: true })).toBe('pro')
    expect(badgeFor({ plan: 'free', isPro: false })).toBe('free')
  })
})

import { describe, expect, it } from 'vitest'
import { campaignWasEverPro } from './CampaignEverPro'

describe('campaignWasEverPro', () => {
  it('is true for a campaign on Pro now', () => {
    expect(campaignWasEverPro({ isPro: true, details: {} })).toBe(true)
  })

  it.each([
    ['isProUpdatedAt', { isProUpdatedAt: 1_700_000_000_000 }],
    ['subscriptionId', { subscriptionId: 'sub_123' }],
    ['subscriptionCanceledAt', { subscriptionCanceledAt: 1_700_000_000_000 }],
  ])('is true for a cancelled campaign that left %s behind', (_, details) => {
    expect(campaignWasEverPro({ isPro: false, details })).toBe(true)
  })

  it('is false for a campaign that was never Pro', () => {
    expect(
      campaignWasEverPro({
        isPro: false,
        details: { subscriptionId: null, subscriptionCanceledAt: null },
      }),
    ).toBe(false)
    expect(campaignWasEverPro({ isPro: null, details: null })).toBe(false)
  })
})

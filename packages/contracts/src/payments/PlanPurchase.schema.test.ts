import { describe, expect, it } from 'vitest'
import {
  AdminExtendPlanSchema,
  AdminSetPlanSchema,
  PlanPurchaseMetadataSchema,
} from './PlanPurchase.schema'

describe('PlanPurchaseMetadataSchema', () => {
  it('accepts pro and team', () => {
    expect(
      PlanPurchaseMetadataSchema.safeParse({ campaignId: 1, plan: 'team' })
        .success,
    ).toBe(true)
  })

  it('rejects free, which is not purchasable', () => {
    expect(
      PlanPurchaseMetadataSchema.safeParse({ campaignId: 1, plan: 'free' })
        .success,
    ).toBe(false)
  })
})

describe('admin plan schemas', () => {
  it('requires a reason to set a plan', () => {
    expect(
      AdminSetPlanSchema.safeParse({ plan: 'pro', reason: '' }).success,
    ).toBe(false)
  })

  it('lets endsAt be null to clear the override', () => {
    expect(
      AdminExtendPlanSchema.safeParse({ endsAt: null, reason: 'runoff' })
        .success,
    ).toBe(true)
  })
})

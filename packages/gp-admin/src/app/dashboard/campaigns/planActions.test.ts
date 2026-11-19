import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SdkError } from '@/shared/gpApi'

const mockHas = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ has: mockHas }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mockSetPlan = vi.fn()
const mockRefund = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: (fn: (client: unknown) => unknown) =>
    fn({ campaigns: { setPlan: mockSetPlan, refundPlan: mockRefund } }),
}))

import { refundCampaignPlan, setCampaignPlan } from './planActions'

beforeEach(() => {
  vi.clearAllMocks()
  mockHas.mockReturnValue(true)
})

describe('plan actions', () => {
  it('refuses without write_campaigns', async () => {
    mockHas.mockReturnValue(false)

    const result = await setCampaignPlan(1, 2, { plan: 'pro', reason: 'x' })

    expect(result).toEqual({
      data: null,
      error: 'Missing write_campaigns permission',
    })
    expect(mockSetPlan).not.toHaveBeenCalled()
  })

  it('returns the plan state on success', async () => {
    mockSetPlan.mockResolvedValue({ plan: 'pro' })

    const result = await setCampaignPlan(1, 2, { plan: 'pro', reason: 'x' })

    expect(mockSetPlan).toHaveBeenCalledWith(1, { plan: 'pro', reason: 'x' })
    expect(result).toEqual({ data: { plan: 'pro' }, error: null })
  })

  it('refuses a refund from a non-admin with write_campaigns', async () => {
    mockHas.mockImplementation(
      (check: { permission?: string; role?: string }) =>
        check.permission === 'write_campaigns'
    )

    const result = await refundCampaignPlan(1, 2)

    expect(result).toEqual({
      data: null,
      error: 'Only admins can refund a plan',
    })
    expect(mockRefund).not.toHaveBeenCalled()
  })

  it("returns gp-api's 409 message instead of throwing", async () => {
    mockRefund.mockRejectedValue(
      new SdkError(409, 'Conflict', undefined, {
        message: 'Cancel the Stripe subscription before refunding this plan',
        errorCode: 'ACTIVE_SUBSCRIPTION',
      })
    )

    const result = await refundCampaignPlan(1, 2)

    expect(result).toEqual({
      data: null,
      error: 'Cancel the Stripe subscription before refunding this plan',
    })
  })
})

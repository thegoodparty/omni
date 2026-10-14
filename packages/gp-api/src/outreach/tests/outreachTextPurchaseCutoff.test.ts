import { addDays, format } from 'date-fns'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PurchaseType } from '@/payments/purchase.types'
import { StripeService } from '@/vendors/stripe/services/stripe.service'

const service = useTestService()

describe('text purchase past the SMS compliance cutoff', () => {
  it('refuses the checkout without minting a session', async () => {
    const slug = 'text-purchase-cutoff'
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        slug,
        organizationSlug: slug,
        userId: service.user.id,
        isPro: true,
        details: {
          electionDate: format(addDays(new Date(), 10), 'yyyy-MM-dd'),
        },
      },
    })
    const checkout = vi.spyOn(
      service.app.get(StripeService),
      'createCustomCheckoutSession',
    )

    const res = await service.client.post(
      '/v1/payments/purchase/create-checkout-session',
      {
        type: PurchaseType.TEXT,
        metadata: {
          outreachType: 'p2p',
          contactCount: 500,
          audienceSize: 500,
        },
      },
      { headers: { 'x-organization-slug': slug } },
    )

    expect(res.status).toBe(409)
    expect(res.data.errorCode).toBe('SMS_COMPLIANCE_CUTOFF')
    expect(checkout).not.toHaveBeenCalled()
  })
})

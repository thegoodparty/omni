import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { OutreachStatus, OutreachType } from '../../generated/prisma'

const service = useTestService()

const retrieveCheckoutSessionWithCharge = vi.fn()

let orgSlug: string
let campaignId: number

beforeEach(async () => {
  retrieveCheckoutSessionWithCharge.mockReset()

  const stripe = service.app.get(StripeService)
  vi.spyOn(stripe, 'retrieveCheckoutSessionWithCharge').mockImplementation(
    retrieveCheckoutSessionWithCharge,
  )

  campaignId = 995
  orgSlug = `campaign-${campaignId}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe-receipt',
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
})

const seedOutreach = (
  overrides: Partial<{
    stripeCheckoutSessionId: string | null
  }> = {},
) =>
  service.prisma.outreach.create({
    data: {
      campaignId,
      outreachType: OutreachType.p2p,
      name: 'Likely voters — SMS',
      status: OutreachStatus.pending,
      stripeCheckoutSessionId: 'cs_test_123',
      ...overrides,
    },
  })

const getReceipt = (id: number) =>
  service.client.get(`/v1/outreach/${id}/receipt`, {
    headers: { 'x-organization-slug': orgSlug },
  })

describe('GET /v1/outreach/:id/receipt', () => {
  it('returns the charge details in dollars from the expanded session', async () => {
    retrieveCheckoutSessionWithCharge.mockResolvedValue({
      amount_total: 4200,
      payment_intent: {
        id: 'pi_test_1',
        latest_charge: {
          id: 'ch_test_1',
          receipt_url: 'https://pay.stripe.com/receipts/rcpt_1',
          created: 1_780_000_000,
          payment_method_details: {
            card: { brand: 'visa', last4: '4242' },
          },
        },
      },
    })
    const row = await seedOutreach()

    const res = await getReceipt(row.id)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      amount: 42,
      cardBrand: 'visa',
      cardLast4: '4242',
      receiptUrl: 'https://pay.stripe.com/receipts/rcpt_1',
      paidAt: new Date(1_780_000_000 * 1000).toISOString(),
    })
    expect(retrieveCheckoutSessionWithCharge).toHaveBeenCalledWith(
      'cs_test_123',
    )
  })

  it('404s a free-texts row that never recorded a session', async () => {
    const row = await seedOutreach({ stripeCheckoutSessionId: null })

    const res = await getReceipt(row.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(retrieveCheckoutSessionWithCharge).not.toHaveBeenCalled()
  })

  it('502s when Stripe fails rather than returning an empty receipt', async () => {
    retrieveCheckoutSessionWithCharge.mockRejectedValue(
      new Error('stripe down'),
    )
    const row = await seedOutreach()

    const res = await getReceipt(row.id)

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })

  it("404s another campaign's outreach", async () => {
    const foreignCampaignId = 994
    await service.prisma.organization.create({
      data: {
        slug: `campaign-${foreignCampaignId}`,
        ownerId: service.user.id,
        positionId: 'pos-2',
      },
    })
    await service.prisma.campaign.create({
      data: {
        id: foreignCampaignId,
        organizationSlug: `campaign-${foreignCampaignId}`,
        userId: service.user.id,
        slug: 'other-campaign-receipt',
        details: {},
        data: {},
        aiContent: {},
      },
    })
    const row = await service.prisma.outreach.create({
      data: {
        campaignId: foreignCampaignId,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending,
        stripeCheckoutSessionId: 'cs_test_foreign',
      },
    })

    const res = await getReceipt(row.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(retrieveCheckoutSessionWithCharge).not.toHaveBeenCalled()
  })
})

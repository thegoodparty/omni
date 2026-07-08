import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { addDays, format, subDays } from 'date-fns'
import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '../generated/prisma'

const service = useTestService()

const CHECKOUT_SESSION_ROUTE = '/v1/payments/purchase/checkout-session'
const DATE_FORMAT = 'yyyy-MM-dd'

const futureElectionDate = () => format(addDays(new Date(), 30), DATE_FORMAT)
const pastElectionDate = () => format(subDays(new Date(), 30), DATE_FORMAT)

let campaignSeq = 0
const seedCampaign = async (
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
) => {
  campaignSeq += 1
  const slug = `checkout-guard-${campaignSeq}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      slug,
      organizationSlug: slug,
      userId: service.user.id,
      details: { electionDate: futureElectionDate() },
      ...overrides,
    },
  })
}

const spyOnStripeCheckout = () => {
  const stripe = service.app.get(StripeService)
  return {
    redirect: vi.spyOn(stripe, 'createCheckoutSession'),
    embedded: vi.spyOn(stripe, 'createEmbeddedProSubscriptionCheckoutSession'),
  }
}

describe('POST /v1/payments/purchase/checkout-session', () => {
  it('returns 400 NO_ACTIVE_CAMPAIGN when the user has no campaign', async () => {
    const stripe = spyOnStripeCheckout()

    const res = await service.client.post(CHECKOUT_SESSION_ROUTE, {})

    expect(res.status).toBe(400)
    expect(res.data.errorCode).toBe('NO_ACTIVE_CAMPAIGN')
    expect(stripe.redirect).not.toHaveBeenCalled()
    expect(stripe.embedded).not.toHaveBeenCalled()
  })

  it('returns 400 for the embedded variant when the user has no campaign', async () => {
    const stripe = spyOnStripeCheckout()

    const res = await service.client.post(CHECKOUT_SESSION_ROUTE, {
      embedded: true,
      returnUrl: 'https://app.test/dashboard/pro-upgrade',
    })

    expect(res.status).toBe(400)
    expect(res.data.errorCode).toBe('NO_ACTIVE_CAMPAIGN')
    expect(stripe.redirect).not.toHaveBeenCalled()
    expect(stripe.embedded).not.toHaveBeenCalled()
  })

  it('returns 400 when the election date has passed', async () => {
    await seedCampaign({ details: { electionDate: pastElectionDate() } })
    const stripe = spyOnStripeCheckout()

    const res = await service.client.post(CHECKOUT_SESSION_ROUTE, {})

    expect(res.status).toBe(400)
    expect(res.data.errorCode).toBe('NO_ACTIVE_CAMPAIGN')
    expect(stripe.redirect).not.toHaveBeenCalled()
  })

  it('returns 400 when the campaign lost its primary', async () => {
    await seedCampaign({ primaryResult: 'lost' })
    const stripe = spyOnStripeCheckout()

    const res = await service.client.post(CHECKOUT_SESSION_ROUTE, {})

    expect(res.status).toBe(400)
    expect(res.data.errorCode).toBe('NO_ACTIVE_CAMPAIGN')
    expect(stripe.redirect).not.toHaveBeenCalled()
  })

  it('creates the redirect session for an active campaign', async () => {
    await seedCampaign()
    const stripe = spyOnStripeCheckout()
    stripe.redirect.mockResolvedValue({
      redirectUrl: 'https://stripe.test/checkout',
      checkoutSessionId: 'cs_test_active',
    })

    const res = await service.client.post(CHECKOUT_SESSION_ROUTE, {})

    expect(res.status).toBe(201)
    expect(res.data).toEqual({ redirectUrl: 'https://stripe.test/checkout' })
    const user = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(user.metaData).toMatchObject({
      checkoutSessionId: 'cs_test_active',
    })
  })

  it('creates the embedded session for an active campaign', async () => {
    await seedCampaign()
    const stripe = spyOnStripeCheckout()
    stripe.embedded.mockResolvedValue({
      clientSecret: 'cs_test_secret',
      checkoutSessionId: 'cs_test_embedded',
    })

    const res = await service.client.post(CHECKOUT_SESSION_ROUTE, {
      embedded: true,
      returnUrl: 'https://app.test/dashboard/pro-upgrade',
    })

    expect(res.status).toBe(201)
    expect(res.data).toEqual({ clientSecret: 'cs_test_secret' })
    const user = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(user.metaData).toMatchObject({
      checkoutSessionId: 'cs_test_embedded',
    })
  })
})

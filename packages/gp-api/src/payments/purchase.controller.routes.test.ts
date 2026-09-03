import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { addDays, format, subDays } from 'date-fns'
import { describe, expect, it, vi } from 'vitest'
import { OrganizationRole, Prisma } from '../generated/prisma'
import { PurchaseService } from './services/purchase.service'
import { PurchaseType } from './purchase.types'

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

  // ENG-10819: subscription billing is personally scoped by construction —
  // it resolves via the caller's own userId/metaData, never the org header.
  // A campaignAdmin membership on someone else's org (now that
  // OrganizationRoleGuard is in the request pipeline) must not change that.
  it('ignores a campaignAdmin membership on another org', async () => {
    const owner = await service.prisma.user.create({
      data: { email: 'checkout-owner-regression@goodparty.org' },
    })
    const org = await service.prisma.organization.create({
      data: { slug: 'checkout-owner-regression-org', ownerId: owner.id },
    })
    await service.prisma.campaign.create({
      data: {
        slug: 'checkout-owner-regression-campaign',
        organizationSlug: org.slug,
        userId: owner.id,
        details: { electionDate: futureElectionDate() },
      },
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: service.user.id,
        role: OrganizationRole.campaignAdmin,
      },
    })
    const stripe = spyOnStripeCheckout()

    const res = await service.client.post(
      CHECKOUT_SESSION_ROUTE,
      {},
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(res.status).toBe(400)
    expect(res.data.errorCode).toBe('NO_ACTIVE_CAMPAIGN')
    expect(stripe.redirect).not.toHaveBeenCalled()
  })
})

describe('POST /v1/payments/purchase/portal-session', () => {
  // Same personal-scoping regression as checkout-session, for the portal.
  it('ignores a campaignAdmin membership on another org', async () => {
    const owner = await service.prisma.user.create({
      data: { email: 'portal-owner-regression@goodparty.org' },
    })
    const org = await service.prisma.organization.create({
      data: { slug: 'portal-owner-regression-org', ownerId: owner.id },
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: service.user.id,
        role: OrganizationRole.campaignAdmin,
      },
    })

    const res = await service.client.post(
      '/v1/payments/purchase/portal-session',
      {},
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(res.status).toBe(400)
    expect(res.data.errorCode).toBe('BILLING_CUSTOMER_ID_MISSING')
  })
})

describe('POST /v1/payments/purchase/create-checkout-session', () => {
  // Managers-can-pay decision (Tomer, 2026-07-28): one-time purchases stay
  // manager-allowed, unlike the owner-only subscription routes above. This
  // pins OrganizationRoleGuard's default (owner | campaignAdmin) admitting a
  // campaignAdmin member through the route's @UseOrganization/@UseCampaign
  // chain. PurchaseService is mocked so this proves the guard admitted the
  // request, not that a purchase completed.
  it('admits a campaignAdmin member of the org', async () => {
    const owner = await service.prisma.user.create({
      data: { email: 'create-checkout-owner@goodparty.org' },
    })
    const org = await service.prisma.organization.create({
      data: { slug: 'create-checkout-org', ownerId: owner.id },
    })
    await service.prisma.campaign.create({
      data: {
        slug: 'create-checkout-campaign',
        organizationSlug: org.slug,
        userId: owner.id,
      },
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: service.user.id,
        role: OrganizationRole.campaignAdmin,
      },
    })
    const purchaseService = service.app.get(PurchaseService)
    vi.spyOn(purchaseService, 'createCheckoutSession').mockResolvedValue({
      id: 'cs_test',
      clientSecret: 'secret_test',
      amount: 500,
    })

    const res = await service.client.post(
      '/v1/payments/purchase/create-checkout-session',
      { type: PurchaseType.TEXT, metadata: {} },
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(res.status).not.toBe(403)
    expect(purchaseService.createCheckoutSession).toHaveBeenCalled()
  })
})

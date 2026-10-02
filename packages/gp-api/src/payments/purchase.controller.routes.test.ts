import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { addDays, format, subDays } from 'date-fns'
import { describe, expect, it, vi } from 'vitest'
import { OutreachStatus, OutreachType } from '../generated/prisma'
import { OrganizationRole, Prisma } from '../generated/prisma'
import { PhoneListState } from '@/vendors/peerly/peerly.types'
import { PeerlyPhoneListService } from '@/vendors/peerly/services/peerlyPhoneList.service'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'
import { FREE_TEXTS_OFFER } from '@/shared/constants/freeTextsOffer'
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

    // This one stubs the service itself; leaving the stub in place would
    // make every later checkout test pass without pricing anything.
    vi.mocked(purchaseService.createCheckoutSession).mockRestore()
  })
})

describe('GET /v1/payments/purchase/pro-receipt', () => {
  const PRO_RECEIPT_ROUTE = '/v1/payments/purchase/pro-receipt'

  it('returns 404 when the campaign has no subscription on record', async () => {
    const campaign = await seedCampaign()
    const stripe = service.app.get(StripeService)
    const read = vi.spyOn(stripe, 'retrieveLatestPaidInvoice')

    const res = await service.client.get(PRO_RECEIPT_ROUTE, {
      headers: { 'x-organization-slug': campaign.organizationSlug },
    })

    expect(res.status).toBe(404)
    expect(read).not.toHaveBeenCalled()
  })

  it('returns 404 for a lapsed subscription without reading Stripe', async () => {
    const campaign = await seedCampaign({
      isPro: false,
      details: {
        electionDate: futureElectionDate(),
        subscriptionId: 'sub_receipt_lapsed',
      },
    })
    const stripe = service.app.get(StripeService)
    const read = vi.spyOn(stripe, 'retrieveLatestPaidInvoice')

    const res = await service.client.get(PRO_RECEIPT_ROUTE, {
      headers: { 'x-organization-slug': campaign.organizationSlug },
    })

    expect(res.status).toBe(404)
    expect(read).not.toHaveBeenCalled()
  })

  it('returns the latest paid invoice as a receipt', async () => {
    const campaign = await seedCampaign({
      isPro: true,
      details: {
        electionDate: futureElectionDate(),
        subscriptionId: 'sub_receipt_test',
      },
    })
    const stripe = service.app.get(StripeService)
    const read = vi
      .spyOn(stripe, 'retrieveLatestPaidInvoice')
      .mockResolvedValue({
        invoice: {
          amount_paid: 1000,
          created: 1_700_000_000,
          status_transitions: { paid_at: 1_700_000_100 },
          invoice_pdf: 'https://stripe.test/invoice.pdf',
        },
        charge: {
          receipt_url: 'https://stripe.test/receipt',
          payment_method_details: {
            card: { brand: 'visa', last4: '4242' },
          },
        },
      } as unknown as Awaited<
        ReturnType<StripeService['retrieveLatestPaidInvoice']>
      >)

    const res = await service.client.get(PRO_RECEIPT_ROUTE, {
      headers: { 'x-organization-slug': campaign.organizationSlug },
    })

    expect(res.status).toBe(200)
    expect(read).toHaveBeenCalledWith('sub_receipt_test')
    expect(res.data).toEqual({
      amount: 10,
      cardBrand: 'visa',
      cardLast4: '4242',
      receiptUrl: 'https://stripe.test/invoice.pdf',
      paidAt: new Date(1_700_000_100 * 1000).toISOString(),
    })
  })

  it('returns 502 when Stripe cannot be read', async () => {
    const campaign = await seedCampaign({
      isPro: true,
      details: {
        electionDate: futureElectionDate(),
        subscriptionId: 'sub_receipt_test',
      },
    })
    const stripe = service.app.get(StripeService)
    vi.spyOn(stripe, 'retrieveLatestPaidInvoice').mockRejectedValue(
      new Error('stripe down'),
    )

    const res = await service.client.get(PRO_RECEIPT_ROUTE, {
      headers: { 'x-organization-slug': campaign.organizationSlug },
    })

    expect(res.status).toBe(502)
  })
})

// The one number a p2p checkout may be priced on is the audience of the
// draft being paid for. Everything in the checkout metadata is
// client-controlled, so these go through the real HTTP route and read the
// amount off what the Stripe session was actually created with.
describe('POST /v1/payments/purchase/create-checkout-session — p2p pricing', () => {
  const DRAFT_LIST_LEADS = 8_000
  const OTHER_LIST_LEADS = 10

  // PeerlyPhoneList.token and .peerlyListId are globally unique, so each
  // seeded campaign gets its own pair.
  let listSeq = 900_000
  const draftListIds = new Set<number>()

  const seedP2pDraft = async (
    campaignOverrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
  ) => {
    const campaign = await seedCampaign({ isPro: true, ...campaignOverrides })
    listSeq += 1
    const draftListId = listSeq
    listSeq += 1
    const otherListId = listSeq
    draftListIds.add(draftListId)
    // Two lists this campaign uploaded: the one the draft sends to, and a
    // much smaller one that must have no bearing on the price.
    await service.prisma.peerlyPhoneList.create({
      data: {
        organizationSlug: campaign.organizationSlug,
        campaignId: campaign.id,
        token: `draft-list-${draftListId}`,
        peerlyListId: draftListId,
      },
    })
    await service.prisma.peerlyPhoneList.create({
      data: {
        organizationSlug: campaign.organizationSlug,
        campaignId: campaign.id,
        token: `other-list-${otherListId}`,
        peerlyListId: otherListId,
      },
    })
    const draft = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: campaign.organizationSlug,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending_payment,
        phoneListId: draftListId,
        textCount: DRAFT_LIST_LEADS,
      },
    })
    return { campaign, draft }
  }

  const stubPeerlyCounts = () => {
    const peerly = service.app.get(PeerlyPhoneListService)
    vi.spyOn(peerly, 'checkPhoneListStatus').mockImplementation(
      async (token: string) => ({
        Data: {
          list_id: Number(token.split('-').pop()),
          list_state: PhoneListState.ACTIVE,
        },
      }),
    )
    vi.spyOn(peerly, 'getPhoneListDetails').mockImplementation(
      // The route only reads leads_loaded off this response.
      (async (listId: number) => ({
        leads_loaded: draftListIds.has(listId)
          ? DRAFT_LIST_LEADS
          : OTHER_LIST_LEADS,
      })) as unknown as PeerlyPhoneListService['getPhoneListDetails'],
    )
  }

  const spyOnCustomCheckout = () => {
    const stripe = service.app.get(StripeService)
    return vi
      .spyOn(stripe, 'createCustomCheckoutSession')
      .mockResolvedValue({ id: 'cs_p2p', clientSecret: 'secret', amount: 0 })
  }

  const createSession = (
    organizationSlug: string,
    metadata: Record<string, unknown>,
  ) =>
    service.client.post(
      '/v1/payments/purchase/create-checkout-session',
      { type: PurchaseType.TEXT, metadata },
      { headers: { 'x-organization-slug': organizationSlug } },
    )

  it("prices the draft's own list, not a smaller one the request points at", async () => {
    const { campaign, draft } = await seedP2pDraft()
    stubPeerlyCounts()
    const checkout = spyOnCustomCheckout()

    const res = await createSession(campaign.organizationSlug, {
      outreachType: 'p2p',
      outreachId: draft.id,
      // Both of these are client-controlled and both understate the send.
      contactCount: OTHER_LIST_LEADS,
      audienceSize: OTHER_LIST_LEADS,
    })

    expect(res.status).toBe(201)
    expect(checkout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        amount: calcTextAmountInCents(DRAFT_LIST_LEADS),
      }),
    )
  })

  it('keeps the free-texts offer from covering a send larger than it', async () => {
    const { campaign, draft } = await seedP2pDraft({ hasFreeTextsOffer: true })
    stubPeerlyCounts()
    const checkout = spyOnCustomCheckout()

    const res = await createSession(campaign.organizationSlug, {
      outreachType: 'p2p',
      outreachId: draft.id,
      contactCount: OTHER_LIST_LEADS,
      audienceSize: OTHER_LIST_LEADS,
    })

    expect(res.status).toBe(201)
    expect(checkout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        amount: calcTextAmountInCents(
          DRAFT_LIST_LEADS - FREE_TEXTS_OFFER.COUNT,
        ),
      }),
    )
  })

  it('takes a fully scrubbed p2p list to the $0 path without minting a paid session', async () => {
    const { campaign, draft } = await seedP2pDraft()
    stubPeerlyCounts()
    vi.spyOn(
      service.app.get(PeerlyPhoneListService),
      'getPhoneListDetails',
    ).mockImplementation((async () => ({
      leads_loaded: 0,
    })) as unknown as PeerlyPhoneListService['getPhoneListDetails'])
    const checkout = spyOnCustomCheckout()

    const res = await createSession(campaign.organizationSlug, {
      outreachType: 'p2p',
      outreachId: draft.id,
      contactCount: 0,
      audienceSize: 0,
    })

    expect(res.status).toBe(201)
    expect(res.data).toMatchObject({ amount: 0, clientSecret: '' })
    expect(checkout).not.toHaveBeenCalled()
  })

  it('400s a p2p checkout that names no draft, without minting a session', async () => {
    const { campaign } = await seedP2pDraft()
    stubPeerlyCounts()
    const checkout = spyOnCustomCheckout()

    const res = await createSession(campaign.organizationSlug, {
      outreachType: 'p2p',
      contactCount: 500,
      audienceSize: 500,
    })

    expect(res.status).toBe(400)
    expect(checkout).not.toHaveBeenCalled()
  })

  it('400s a checkout for a draft that finalize already scheduled, without minting a session', async () => {
    const { campaign, draft } = await seedP2pDraft()
    await service.prisma.outreach.update({
      where: { id: draft.id },
      data: {
        status: OutreachStatus.pending,
        projectId: 'peerly-job-1',
        stripeCheckoutSessionId: 'cs_first',
      },
    })
    stubPeerlyCounts()
    const checkout = spyOnCustomCheckout()

    const res = await createSession(campaign.organizationSlug, {
      outreachType: 'p2p',
      outreachId: draft.id,
      contactCount: DRAFT_LIST_LEADS,
      audienceSize: DRAFT_LIST_LEADS,
    })

    expect(res.status).toBe(400)
    expect(checkout).not.toHaveBeenCalled()
  })

  it("400s a p2p checkout naming another campaign's draft", async () => {
    const { campaign } = await seedP2pDraft()
    const { draft: foreignDraft } = await seedP2pDraft()
    stubPeerlyCounts()
    const checkout = spyOnCustomCheckout()

    const res = await createSession(campaign.organizationSlug, {
      outreachType: 'p2p',
      outreachId: foreignDraft.id,
      contactCount: 500,
      audienceSize: 500,
    })

    expect(res.status).toBe(400)
    expect(checkout).not.toHaveBeenCalled()
  })
})

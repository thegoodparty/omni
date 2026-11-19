import { AnalyticsService } from '@/analytics/analytics.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { FeaturesService } from '@/features/services/features.service'
import { PaymentEventsService } from '@/payments/services/paymentEventsService'
import { PurchaseType } from '@/payments/purchase.types'
import { useTestService } from '@/test-service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import { addDays, format, subDays } from 'date-fns'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CampaignPlanLevel,
  CampaignPlanPurchaseKind,
  CampaignPlanPurchaseStatus,
  OrganizationRole,
  PlanPricingModel,
  Prisma,
} from '@/generated/prisma'
import { EVENTS } from '@/vendors/segment/segment.types'
import { firstOrThrow } from '@/shared/test-utils/arrays.util'

const service = useTestService()

const CREATE_ROUTE = '/v1/payments/purchase/create-checkout-session'
const COMPLETE_ROUTE = '/v1/payments/purchase/complete-checkout-session'
const TEAM_UPGRADE_CENTS = PLAN_PRICING.teamCents - PLAN_PRICING.proCents

let seq = 0
const seedCampaign = async (
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
  ownerId = service.user.id,
) => {
  seq += 1
  const slug = `plan-purchase-${seq}`
  await service.prisma.organization.create({ data: { slug, ownerId } })
  return service.prisma.campaign.create({
    data: {
      slug,
      organizationSlug: slug,
      userId: ownerId,
      details: {
        electionDate: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
      },
      ...overrides,
    },
  })
}

const readCampaign = (id: number) =>
  service.prisma.campaign.findUniqueOrThrow({ where: { id } })

const readPurchases = (campaignId: number) =>
  service.prisma.campaignPlanPurchase.findMany({ where: { campaignId } })

const setPlansFlag = (on: boolean) =>
  vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(on)

const createCheckout = (organizationSlug: string, plan: CampaignPlanLevel) =>
  service.client.post(
    CREATE_ROUTE,
    { type: PurchaseType.PLAN, metadata: { plan } },
    { headers: { 'x-organization-slug': organizationSlug } },
  )

const stripe = () => service.app.get(StripeService)

const spyOnSessionCreate = () =>
  vi.spyOn(stripe(), 'createCustomCheckoutSession').mockResolvedValue({
    id: 'cs_created',
    clientSecret: 'secret_created',
    amount: 0,
  })

type PaidSession = {
  sessionId: string
  campaignId: number
  plan: CampaignPlanLevel
  subtotalCents: number
  paymentIntentId?: string
}

// Stripe is mocked at the StripeService boundary only: the session the
// complete route reads, the PaymentIntent marker it checks and stamps, and
// the expanded session the plan handler reads for its PaymentIntent and card.
const stubPaidSessions = (sessions: PaidSession[]) => {
  const bySessionId = new Map(sessions.map((s) => [s.sessionId, s]))
  const find = (sessionId: string) => {
    const session = bySessionId.get(sessionId)
    if (!session) throw new Error(`unexpected session ${sessionId}`)
    return session
  }
  vi.spyOn(stripe(), 'retrieveCheckoutSession').mockImplementation(
    async (sessionId) => {
      const s = find(sessionId)
      return {
        id: s.sessionId,
        status: 'complete',
        payment_status: 'paid',
        payment_intent: s.paymentIntentId ?? null,
        metadata: {
          purchaseType: PurchaseType.PLAN,
          campaignId: String(s.campaignId),
          plan: s.plan,
          userId: String(service.user.id),
        },
      } as unknown as Stripe.Checkout.Session
    },
  )
  vi.spyOn(stripe(), 'retrieveCheckoutSessionWithCharge').mockImplementation(
    async (sessionId) => {
      const s = find(sessionId)
      return {
        id: s.sessionId,
        amount_subtotal: s.subtotalCents,
        amount_total: s.subtotalCents,
        payment_intent: s.paymentIntentId
          ? {
              id: s.paymentIntentId,
              latest_charge: { payment_method_details: { type: 'card' } },
            }
          : null,
      } as unknown as Awaited<
        ReturnType<StripeService['retrieveCheckoutSessionWithCharge']>
      >
    },
  )
  // No marker, ever: models the webhook and the client both passing the
  // marker check before either stamps it, so the handler's own guard is what
  // is under test.
  vi.spyOn(stripe(), 'retrievePaymentIntent').mockResolvedValue({
    metadata: {},
  } as unknown as Stripe.Response<Stripe.PaymentIntent>)
  vi.spyOn(stripe(), 'updatePaymentIntentMetadata').mockResolvedValue(
    {} as unknown as Stripe.Response<Stripe.PaymentIntent>,
  )
  return {
    refund: vi.spyOn(stripe(), 'refundPaymentIntent').mockResolvedValue({
      id: 're_test',
    } as unknown as Stripe.Response<Stripe.Refund>),
  }
}

const complete = (checkoutSessionId: string) =>
  service.client.post(COMPLETE_ROUTE, { checkoutSessionId })

beforeEach(() => {
  setPlansFlag(true)
  vi.spyOn(
    service.app.get(CrmCampaignsService),
    'trackCampaign',
  ).mockResolvedValue(undefined)
  vi.spyOn(service.app.get(SlackService), 'message').mockResolvedValue(
    undefined,
  )
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(
    async () => undefined as never,
  )
  vi.spyOn(service.app.get(AnalyticsService), 'identify').mockResolvedValue(
    undefined,
  )
})

describe('PLAN checkout creation', () => {
  it('prices Pro from Free at the list price', async () => {
    const campaign = await seedCampaign()
    const create = spyOnSessionCreate()

    const res = await createCheckout(
      campaign.organizationSlug,
      CampaignPlanLevel.pro,
    )

    expect(res.status).toBe(201)
    expect(create).toHaveBeenCalledOnce()
    expect(firstOrThrow(create.mock.calls)[1]).toMatchObject({
      purchaseType: PurchaseType.PLAN,
      amount: PLAN_PRICING.proCents,
      productName: 'Pro plan',
      metadata: { campaignId: campaign.id, plan: CampaignPlanLevel.pro },
    })
  })

  it('prices Team from Pro at the difference', async () => {
    const campaign = await seedCampaign({
      isPro: true,
      plan: CampaignPlanLevel.pro,
      planPricingModel: PlanPricingModel.one_time,
    })
    const create = spyOnSessionCreate()

    const res = await createCheckout(
      campaign.organizationSlug,
      CampaignPlanLevel.team,
    )

    expect(res.status).toBe(201)
    expect(firstOrThrow(create.mock.calls)[1].amount).toBe(TEAM_UPGRADE_CENTS)
  })

  it('prices Team from Free at the list price', async () => {
    const campaign = await seedCampaign()
    const create = spyOnSessionCreate()

    await createCheckout(campaign.organizationSlug, CampaignPlanLevel.team)

    expect(firstOrThrow(create.mock.calls)[1].amount).toBe(
      PLAN_PRICING.teamCents,
    )
  })

  it('refuses a manager who is not the owner', async () => {
    const owner = await service.prisma.user.create({
      data: { email: 'plan-owner@goodparty.org' },
    })
    const campaign = await seedCampaign({}, owner.id)
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: campaign.organizationSlug,
        userId: service.user.id,
        role: OrganizationRole.campaignAdmin,
      },
    })
    const create = spyOnSessionCreate()

    const res = await createCheckout(
      campaign.organizationSlug,
      CampaignPlanLevel.pro,
    )

    expect(res.status).toBe(403)
    expect(res.data.errorCode).toBe('NOT_CAMPAIGN_OWNER')
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses a campaign past its election', async () => {
    const campaign = await seedCampaign({
      details: { electionDate: format(subDays(new Date(), 1), 'yyyy-MM-dd') },
    })
    const create = spyOnSessionCreate()

    const res = await createCheckout(
      campaign.organizationSlug,
      CampaignPlanLevel.pro,
    )

    expect(res.status).toBe(400)
    expect(res.data.errorCode).toBe('NO_ACTIVE_CAMPAIGN')
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses a grandfathered subscriber', async () => {
    const campaign = await seedCampaign({
      isPro: true,
      plan: CampaignPlanLevel.pro,
      planPricingModel: PlanPricingModel.subscription,
    })
    const create = spyOnSessionCreate()

    const res = await createCheckout(
      campaign.organizationSlug,
      CampaignPlanLevel.team,
    )

    expect(res.status).toBe(409)
    expect(res.data.errorCode).toBe('SUBSCRIPTION_PLAN')
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses Pro for a campaign already on Pro', async () => {
    const campaign = await seedCampaign({
      isPro: true,
      plan: CampaignPlanLevel.pro,
      planPricingModel: PlanPricingModel.one_time,
    })
    const create = spyOnSessionCreate()

    const res = await createCheckout(
      campaign.organizationSlug,
      CampaignPlanLevel.pro,
    )

    expect(res.status).toBe(409)
    expect(res.data.errorCode).toBe('ALREADY_ON_PLAN')
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses every plan checkout with the flag off', async () => {
    setPlansFlag(false)
    const campaign = await seedCampaign()
    const create = spyOnSessionCreate()

    const res = await createCheckout(
      campaign.organizationSlug,
      CampaignPlanLevel.pro,
    )

    expect(res.status).toBe(403)
    expect(res.data.errorCode).toBe('PLANS_NOT_AVAILABLE')
    expect(create).not.toHaveBeenCalled()
  })
})

describe('PLAN checkout completion', () => {
  it('fulfils Pro from Free: plan, isPro, credit and one paid row', async () => {
    const campaign = await seedCampaign()
    stubPaidSessions([
      {
        sessionId: 'cs_pro',
        campaignId: campaign.id,
        plan: CampaignPlanLevel.pro,
        subtotalCents: PLAN_PRICING.proCents,
        paymentIntentId: 'pi_pro',
      },
    ])
    const onBecamePro = vi.spyOn(
      service.app.get(PaymentEventsService),
      'onBecamePro',
    )

    const res = await complete('cs_pro')

    expect(res.status).toBe(201)
    const updated = await readCampaign(campaign.id)
    expect(updated).toMatchObject({
      plan: CampaignPlanLevel.pro,
      isPro: true,
      planPricingModel: PlanPricingModel.one_time,
      outreachCreditCents: PLAN_PRICING.includedCreditCents,
      planEndedAt: null,
    })
    expect(updated.planPaidAt).toBeInstanceOf(Date)
    const purchases = await readPurchases(campaign.id)
    expect(purchases).toHaveLength(1)
    expect(purchases[0]).toMatchObject({
      status: CampaignPlanPurchaseStatus.paid,
      kind: CampaignPlanPurchaseKind.plan,
      plan: CampaignPlanLevel.pro,
      amountCents: PLAN_PRICING.proCents,
      creditGrantedCents: PLAN_PRICING.includedCreditCents,
      stripePaymentIntentId: 'pi_pro',
      paymentMethodType: 'card',
      buyerUserId: service.user.id,
    })
    expect(onBecamePro).toHaveBeenCalledOnce()
    expect(firstOrThrow(onBecamePro.mock.calls)[0].id).toBe(campaign.id)
    expect(service.app.get(AnalyticsService).track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Account.ProUpgradeComplete,
      {
        plan: CampaignPlanLevel.pro,
        pricingModel: 'oneTime',
        paymentMethod: 'card',
        upgradeFrom: CampaignPlanLevel.free,
      },
    )
    expect(service.app.get(AnalyticsService).identify).toHaveBeenCalledWith(
      service.user.id,
      { plan: CampaignPlanLevel.pro },
    )
  })

  it('fulfils Team from Pro as an upgrade that grants no credit', async () => {
    const paidAt = new Date('2026-10-01T00:00:00Z')
    const campaign = await seedCampaign({
      isPro: true,
      plan: CampaignPlanLevel.pro,
      planPricingModel: PlanPricingModel.one_time,
      planPaidAt: paidAt,
      outreachCreditCents: 4200,
    })
    stubPaidSessions([
      {
        sessionId: 'cs_upgrade',
        campaignId: campaign.id,
        plan: CampaignPlanLevel.team,
        subtotalCents: TEAM_UPGRADE_CENTS,
        paymentIntentId: 'pi_upgrade',
      },
    ])
    const onBecamePro = vi.spyOn(
      service.app.get(PaymentEventsService),
      'onBecamePro',
    )

    const res = await complete('cs_upgrade')

    expect(res.status).toBe(201)
    const updated = await readCampaign(campaign.id)
    expect(updated).toMatchObject({
      plan: CampaignPlanLevel.team,
      isPro: true,
      outreachCreditCents: 4200,
      planPaidAt: paidAt,
    })
    const purchases = await readPurchases(campaign.id)
    expect(purchases).toHaveLength(1)
    expect(purchases[0]).toMatchObject({
      kind: CampaignPlanPurchaseKind.team_upgrade,
      plan: CampaignPlanLevel.team,
      amountCents: TEAM_UPGRADE_CENTS,
      creditGrantedCents: 0,
    })
    expect(onBecamePro).not.toHaveBeenCalled()
  })

  it('fulfils Team from Free with the included credit', async () => {
    const campaign = await seedCampaign()
    stubPaidSessions([
      {
        sessionId: 'cs_team',
        campaignId: campaign.id,
        plan: CampaignPlanLevel.team,
        subtotalCents: PLAN_PRICING.teamCents,
        paymentIntentId: 'pi_team',
      },
    ])

    const res = await complete('cs_team')

    expect(res.status).toBe(201)
    expect(await readCampaign(campaign.id)).toMatchObject({
      plan: CampaignPlanLevel.team,
      isPro: true,
      outreachCreditCents: PLAN_PRICING.includedCreditCents,
    })
    expect((await readPurchases(campaign.id))[0]).toMatchObject({
      kind: CampaignPlanPurchaseKind.plan,
      amountCents: PLAN_PRICING.teamCents,
    })
  })

  it('fulfils a session completed twice once, even concurrently', async () => {
    const campaign = await seedCampaign()
    stubPaidSessions([
      {
        sessionId: 'cs_twice',
        campaignId: campaign.id,
        plan: CampaignPlanLevel.pro,
        subtotalCents: PLAN_PRICING.proCents,
        paymentIntentId: 'pi_twice',
      },
    ])
    const onBecamePro = vi.spyOn(
      service.app.get(PaymentEventsService),
      'onBecamePro',
    )

    const results = await Promise.all([
      complete('cs_twice'),
      complete('cs_twice'),
    ])
    const third = await complete('cs_twice')

    expect(results.map((r) => r.status)).toEqual([201, 201])
    expect(third.status).toBe(201)
    expect(await readPurchases(campaign.id)).toHaveLength(1)
    expect((await readCampaign(campaign.id)).outreachCreditCents).toBe(
      PLAN_PRICING.includedCreditCents,
    )
    expect(onBecamePro).toHaveBeenCalledOnce()
  })

  it('flips Pro on redelivery when the paid row committed first', async () => {
    const campaign = await seedCampaign({
      plan: CampaignPlanLevel.pro,
      planPricingModel: PlanPricingModel.one_time,
      outreachCreditCents: PLAN_PRICING.includedCreditCents,
    })
    await service.prisma.campaignPlanPurchase.create({
      data: {
        campaignId: campaign.id,
        buyerUserId: service.user.id,
        kind: CampaignPlanPurchaseKind.plan,
        plan: CampaignPlanLevel.pro,
        amountCents: PLAN_PRICING.proCents,
        creditGrantedCents: PLAN_PRICING.includedCreditCents,
        stripeCheckoutSessionId: 'cs_heal',
        stripePaymentIntentId: 'pi_heal',
      },
    })
    stubPaidSessions([
      {
        sessionId: 'cs_heal',
        campaignId: campaign.id,
        plan: CampaignPlanLevel.pro,
        subtotalCents: PLAN_PRICING.proCents,
        paymentIntentId: 'pi_heal',
      },
    ])
    const onBecamePro = vi.spyOn(
      service.app.get(PaymentEventsService),
      'onBecamePro',
    )

    const response = await complete('cs_heal')

    expect(response.status).toBe(201)
    const healed = await readCampaign(campaign.id)
    expect(healed.isPro).toBe(true)
    expect(healed.outreachCreditCents).toBe(PLAN_PRICING.includedCreditCents)
    expect(await readPurchases(campaign.id)).toHaveLength(1)
    expect(onBecamePro).toHaveBeenCalledOnce()
  })

  it('fulfils a promo-covered session with no PaymentIntent once', async () => {
    const campaign = await seedCampaign()
    stubPaidSessions([
      {
        sessionId: 'cs_free',
        campaignId: campaign.id,
        plan: CampaignPlanLevel.pro,
        subtotalCents: PLAN_PRICING.proCents,
      },
    ])

    await complete('cs_free')
    await complete('cs_free')

    const purchases = await readPurchases(campaign.id)
    expect(purchases).toHaveLength(1)
    expect(firstOrThrow(purchases).stripePaymentIntentId).toBeNull()
    expect((await readCampaign(campaign.id)).outreachCreditCents).toBe(
      PLAN_PRICING.includedCreditCents,
    )
  })

  it('refunds a second paid Pro session and returns 409', async () => {
    const campaign = await seedCampaign()
    const { refund } = stubPaidSessions([
      {
        sessionId: 'cs_tab_one',
        campaignId: campaign.id,
        plan: CampaignPlanLevel.pro,
        subtotalCents: PLAN_PRICING.proCents,
        paymentIntentId: 'pi_tab_one',
      },
      {
        sessionId: 'cs_tab_two',
        campaignId: campaign.id,
        plan: CampaignPlanLevel.pro,
        subtotalCents: PLAN_PRICING.proCents,
        paymentIntentId: 'pi_tab_two',
      },
    ])

    const first = await complete('cs_tab_one')
    const second = await complete('cs_tab_two')

    expect(first.status).toBe(201)
    expect(second.status).toBe(409)
    expect(refund).toHaveBeenCalledExactlyOnceWith(
      'pi_tab_two',
      'plan-dup-refund-cs_tab_two',
    )
    expect((await readCampaign(campaign.id)).outreachCreditCents).toBe(
      PLAN_PRICING.includedCreditCents,
    )
    const refunded =
      await service.prisma.campaignPlanPurchase.findUniqueOrThrow({
        where: { stripeCheckoutSessionId: 'cs_tab_two' },
      })
    expect(refunded).toMatchObject({
      status: CampaignPlanPurchaseStatus.refunded,
      creditGrantedCents: 0,
    })
    expect(refunded.refundedAt).toBeInstanceOf(Date)

    // A redelivery of the refunded session neither refunds again nor fulfils.
    const redelivery = await complete('cs_tab_two')
    expect(redelivery.status).toBe(201)
    expect(refund).toHaveBeenCalledOnce()
    expect(await readPurchases(campaign.id)).toHaveLength(2)
  })

  it('refunds an upgrade whose Pro was refunded before it was paid', async () => {
    const campaign = await seedCampaign()
    const { refund } = stubPaidSessions([
      {
        sessionId: 'cs_stale_upgrade',
        campaignId: campaign.id,
        plan: CampaignPlanLevel.team,
        subtotalCents: TEAM_UPGRADE_CENTS,
        paymentIntentId: 'pi_stale_upgrade',
      },
    ])

    const res = await complete('cs_stale_upgrade')

    expect(res.status).toBe(409)
    expect(refund).toHaveBeenCalledExactlyOnceWith(
      'pi_stale_upgrade',
      'plan-dup-refund-cs_stale_upgrade',
    )
    expect(await readCampaign(campaign.id)).toMatchObject({
      plan: CampaignPlanLevel.free,
      isPro: false,
    })
  })

  it('leaves state unchanged when the duplicate refund fails', async () => {
    const campaign = await seedCampaign({
      isPro: true,
      plan: CampaignPlanLevel.pro,
      planPricingModel: PlanPricingModel.one_time,
    })
    const { refund } = stubPaidSessions([
      {
        sessionId: 'cs_refund_fails',
        campaignId: campaign.id,
        plan: CampaignPlanLevel.pro,
        subtotalCents: PLAN_PRICING.proCents,
        paymentIntentId: 'pi_refund_fails',
      },
    ])
    refund.mockRejectedValue(new Error('stripe down'))

    const res = await complete('cs_refund_fails')

    expect(res.status).toBe(502)
    expect(await readPurchases(campaign.id)).toHaveLength(0)
  })
})

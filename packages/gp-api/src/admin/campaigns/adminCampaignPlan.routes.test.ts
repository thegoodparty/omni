import { HttpStatus } from '@nestjs/common'
import { addDays, subDays } from 'date-fns'
import { randomUUID } from 'crypto'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import { AnalyticsService } from '@/analytics/analytics.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  CampaignPlanLevel,
  CampaignPlanPurchaseKind,
  CampaignPlanPurchaseStatus,
  OutreachStatus,
  OutreachType,
  PlanPricingModel,
  Prisma,
} from '../../generated/prisma'

const service = useTestService()

const MACHINE_HEADERS = { Authorization: 'Bearer mt_test' }

const asMachine = () =>
  vi
    .spyOn<
      AuthProvider,
      'verifyM2MToken'
    >(service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN), 'verifyM2MToken')
    .mockResolvedValue({ id: 'mt_test', subject: 'mch_gp_admin' })

const seedCampaign = async (
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
) => {
  const slug = `admin-plan-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      slug,
      organizationSlug: slug,
      userId: service.user.id,
      details: {},
      ...overrides,
    },
  })
}

const seedPurchase = (
  campaignId: number,
  overrides: Partial<Prisma.CampaignPlanPurchaseUncheckedCreateInput> = {},
) =>
  service.prisma.campaignPlanPurchase.create({
    data: {
      campaignId,
      buyerUserId: service.user.id,
      kind: CampaignPlanPurchaseKind.plan,
      plan: CampaignPlanLevel.pro,
      amountCents: PLAN_PRICING.proCents,
      creditGrantedCents: PLAN_PRICING.includedCreditCents,
      stripeCheckoutSessionId: `cs_${randomUUID()}`,
      stripePaymentIntentId: `pi_${randomUUID()}`,
      ...overrides,
    },
  })

const readCampaign = (id: number) =>
  service.prisma.campaign.findUniqueOrThrow({ where: { id } })

const planPath = (id: number, suffix = '') =>
  `/v1/admin/campaigns/${id}/plan${suffix}`

let track: ReturnType<typeof vi.spyOn>
let refund: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  asMachine()
  vi.spyOn(
    service.app.get(CrmCampaignsService),
    'trackCampaign',
  ).mockResolvedValue(undefined)
  vi.spyOn(service.app.get(SlackService), 'message').mockResolvedValue(
    undefined,
  )
  vi.spyOn(service.app.get(AnalyticsService), 'identify').mockResolvedValue(
    undefined,
  )
  track = vi
    .spyOn(service.app.get(AnalyticsService), 'track')
    .mockImplementation(async () => undefined as never)
  refund = vi.spyOn(service.app.get(StripeService), 'refundPaymentIntent')
  refund.mockResolvedValue({ id: 're_test' } as Stripe.Response<Stripe.Refund>)
})

describe('admin plan routes guard', () => {
  it.each([
    ['', { plan: 'pro', reason: 'comp' }],
    ['/extend', { endsAt: null, reason: 'clear' }],
    ['/refund', {}],
  ])('rejects a session user on POST plan%s', async (suffix, body) => {
    const campaign = await seedCampaign()

    const res = await service.client.post(planPath(campaign.id, suffix), body)

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
    expect((await readCampaign(campaign.id)).plan).toBe(CampaignPlanLevel.free)
  })
})

describe('POST /v1/admin/campaigns/:id/plan', () => {
  it('comps Pro on a Free campaign with the given credit and no purchase row', async () => {
    const campaign = await seedCampaign()

    const res = await service.client.post(
      planPath(campaign.id),
      { plan: 'pro', creditCents: 5000, reason: 'press partner' },
      { headers: MACHINE_HEADERS },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toMatchObject({ plan: 'pro', outreachCreditCents: 5000 })
    const updated = await readCampaign(campaign.id)
    expect(updated).toMatchObject({
      plan: CampaignPlanLevel.pro,
      isPro: true,
      planPricingModel: PlanPricingModel.one_time,
      outreachCreditCents: 5000,
    })
    expect(updated.details?.isProUpdatedAt).toBeDefined()
    expect(
      await service.prisma.campaignPlanPurchase.count({
        where: { campaignId: campaign.id },
      }),
    ).toBe(0)
  })

  it('sets a Pro campaign back to Free and turns isPro off', async () => {
    const campaign = await seedCampaign({
      isPro: true,
      plan: CampaignPlanLevel.pro,
      planPricingModel: PlanPricingModel.one_time,
    })

    const res = await service.client.post(
      planPath(campaign.id),
      { plan: 'free', reason: 'ended early' },
      { headers: MACHINE_HEADERS },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(await readCampaign(campaign.id)).toMatchObject({
      plan: CampaignPlanLevel.free,
      isPro: false,
      planPricingModel: null,
    })
  })

  it('refuses Free while a Stripe subscription is attached', async () => {
    const campaign = await seedCampaign({
      isPro: true,
      plan: CampaignPlanLevel.pro,
      details: { subscriptionId: 'sub_test_admin_plan' },
    })

    const res = await service.client.post(
      planPath(campaign.id),
      { plan: 'free', reason: 'ended early' },
      { headers: MACHINE_HEADERS },
    )

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(await readCampaign(campaign.id)).toMatchObject({
      plan: CampaignPlanLevel.pro,
      isPro: true,
    })
  })

  it('rejects a body with no reason', async () => {
    const campaign = await seedCampaign()

    const res = await service.client.post(
      planPath(campaign.id),
      { plan: 'pro' },
      { headers: MACHINE_HEADERS },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect((await readCampaign(campaign.id)).isPro).toBe(false)
  })
})

describe('POST /v1/admin/campaigns/:id/plan/extend', () => {
  const endedPro = () =>
    seedCampaign({
      isPro: false,
      plan: CampaignPlanLevel.pro,
      planPricingModel: PlanPricingModel.one_time,
      planEndedAt: subDays(new Date(), 3),
      details: { electionDate: '2026-01-01' },
    })

  it('brings an ended plan back with a future date, and clearing the override restores the computed date', async () => {
    const campaign = await endedPro()
    const endsAt = addDays(new Date(), 20).toISOString()

    const res = await service.client.post(
      planPath(campaign.id, '/extend'),
      { endsAt, reason: 'runoff' },
      { headers: MACHINE_HEADERS },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.planEndsAt).toBe(endsAt)
    expect(await readCampaign(campaign.id)).toMatchObject({
      isPro: true,
      planEndedAt: null,
      planEndsAtOverride: new Date(endsAt),
    })
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Account.PaidPlanUpdated,
      { change: 'extended', reason: 'runoff' },
    )

    const cleared = await service.client.post(
      planPath(campaign.id, '/extend'),
      { endsAt: null, reason: 'undo' },
      { headers: MACHINE_HEADERS },
    )

    expect(cleared.status).toBe(HttpStatus.OK)
    expect((await readCampaign(campaign.id)).planEndsAtOverride).toBeNull()
    expect(cleared.data.planEndsAt).toBe('2026-01-15T00:00:00.000Z')
  })

  it('keeps an ended plan ended when the new date is already past', async () => {
    const campaign = await endedPro()

    await service.client.post(
      planPath(campaign.id, '/extend'),
      { endsAt: subDays(new Date(), 1).toISOString(), reason: 'note' },
      { headers: MACHINE_HEADERS },
    )

    expect(await readCampaign(campaign.id)).toMatchObject({
      isPro: false,
      planEndedAt: expect.any(Date),
    })
  })

  it('refuses a campaign with no plan', async () => {
    const campaign = await seedCampaign()

    const res = await service.client.post(
      planPath(campaign.id, '/extend'),
      { endsAt: addDays(new Date(), 5).toISOString(), reason: 'x' },
      { headers: MACHINE_HEADERS },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect((await readCampaign(campaign.id)).planEndsAtOverride).toBeNull()
  })
})

describe('POST /v1/admin/campaigns/:id/plan/refund', () => {
  const paidPro = async () => {
    const campaign = await seedCampaign({
      isPro: true,
      plan: CampaignPlanLevel.pro,
      planPricingModel: PlanPricingModel.one_time,
      planPaidAt: subDays(new Date(), 4),
      outreachCreditCents: 12_000,
    })
    const purchase = await seedPurchase(campaign.id, {
      createdAt: subDays(new Date(), 4),
    })
    return { campaign, purchase }
  }

  it('refunds a Pro purchase under its keyed id and takes the plan back', async () => {
    const { campaign, purchase } = await paidPro()
    await service.prisma.outreach.create({
      data: {
        organizationSlug: campaign.organizationSlug,
        campaignId: campaign.id,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.completed,
      },
    })

    const res = await service.client.post(
      planPath(campaign.id, '/refund'),
      {},
      { headers: MACHINE_HEADERS },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      refundedCents: PLAN_PRICING.proCents,
      eligibility: { daysSincePurchase: 4, outreachSent: true },
    })
    expect(refund).toHaveBeenCalledExactlyOnceWith(
      purchase.stripePaymentIntentId,
      `plan-refund-${purchase.id}`,
    )
    expect(await readCampaign(campaign.id)).toMatchObject({
      plan: CampaignPlanLevel.free,
      isPro: false,
      outreachCreditCents: 0,
    })
    expect(
      await service.prisma.campaignPlanPurchase.findUniqueOrThrow({
        where: { id: purchase.id },
      }),
    ).toMatchObject({
      status: CampaignPlanPurchaseStatus.refunded,
      refundedAt: expect.any(Date),
    })
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Account.PaidPlanUpdated,
      { change: 'refunded', reason: 'admin_refund' },
    )
  })

  it('reports no outreach sent when none went out since the purchase', async () => {
    const { campaign } = await paidPro()

    const res = await service.client.post(
      planPath(campaign.id, '/refund'),
      {},
      { headers: MACHINE_HEADERS },
    )

    expect(res.data.eligibility.outreachSent).toBe(false)
  })

  it('returns a Team upgrade refund to Pro and keeps isPro', async () => {
    const { campaign } = await paidPro()
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { plan: CampaignPlanLevel.team },
    })
    const upgrade = await seedPurchase(campaign.id, {
      kind: CampaignPlanPurchaseKind.team_upgrade,
      plan: CampaignPlanLevel.team,
      amountCents: PLAN_PRICING.teamCents - PLAN_PRICING.proCents,
      creditGrantedCents: 0,
    })

    const res = await service.client.post(
      planPath(campaign.id, '/refund'),
      {},
      { headers: MACHINE_HEADERS },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.refundedCents).toBe(upgrade.amountCents)
    expect(await readCampaign(campaign.id)).toMatchObject({
      plan: CampaignPlanLevel.pro,
      isPro: true,
      outreachCreditCents: 0,
    })
  })

  it('changes nothing when Stripe throws', async () => {
    const { campaign, purchase } = await paidPro()
    refund.mockRejectedValue(new Error('stripe down'))

    const res = await service.client.post(
      planPath(campaign.id, '/refund'),
      {},
      { headers: MACHINE_HEADERS },
    )

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    expect(await readCampaign(campaign.id)).toMatchObject({
      plan: CampaignPlanLevel.pro,
      isPro: true,
      outreachCreditCents: 12_000,
    })
    expect(
      (
        await service.prisma.campaignPlanPurchase.findUniqueOrThrow({
          where: { id: purchase.id },
        })
      ).status,
    ).toBe(CampaignPlanPurchaseStatus.paid)
  })

  it('refuses a campaign with no paid purchase', async () => {
    const campaign = await seedCampaign({
      isPro: true,
      plan: CampaignPlanLevel.pro,
    })

    const res = await service.client.post(
      planPath(campaign.id, '/refund'),
      {},
      { headers: MACHINE_HEADERS },
    )

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(refund).not.toHaveBeenCalled()
    expect((await readCampaign(campaign.id)).isPro).toBe(true)
  })
})

describe('isPro on the campaign update routes', () => {
  it('ignores isPro on the M2M PUT', async () => {
    const campaign = await seedCampaign()

    await service.client.put(
      `/v1/campaigns/${campaign.id}`,
      { isPro: true },
      { headers: MACHINE_HEADERS },
    )

    expect((await readCampaign(campaign.id)).isPro).toBe(false)
  })

  it('rejects isPro on the admin PUT', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })
    const campaign = await seedCampaign()

    const res = await service.client.put(`/v1/admin/campaigns/${campaign.id}`, {
      isPro: true,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect((await readCampaign(campaign.id)).isPro).toBe(false)
  })
})

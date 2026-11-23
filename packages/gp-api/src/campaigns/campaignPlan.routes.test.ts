import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import {
  CampaignPlanLevel,
  PlanPricingModel,
  Prisma,
} from '../generated/prisma'

const service = useTestService()

let seq = 0

const seedCampaign = async (
  data: Partial<Prisma.CampaignUncheckedCreateInput> = {},
  electionDate: string | null = '2026-11-03',
) => {
  seq += 1
  const slug = `plan-state-${seq}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      slug,
      organizationSlug: slug,
      userId: service.user.id,
      details: electionDate ? { electionDate } : {},
      ...data,
    },
  })
}

const getMine = (slug: string) =>
  service.client.get('/v1/campaigns/mine', {
    headers: { 'x-organization-slug': slug },
  })

describe('plan state on GET /v1/campaigns/mine', () => {
  it('defaults a new campaign to free with no credit and an end date 14 days after the election', async () => {
    const campaign = await seedCampaign()

    const res = await getMine(campaign.slug)

    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({
      plan: 'free',
      planPricingModel: null,
      planPaidAt: null,
      planEndedAt: null,
      outreachCreditCents: 0,
      planEndsAt: '2026-11-17T00:00:00.000Z',
    })
  })

  it('returns the override as the end date and the stored plan fields', async () => {
    const paidAt = new Date('2026-09-01T15:00:00Z')
    const campaign = await seedCampaign({
      plan: CampaignPlanLevel.team,
      planPricingModel: PlanPricingModel.one_time,
      planPaidAt: paidAt,
      planEndsAtOverride: new Date('2027-01-05T00:00:00Z'),
      outreachCreditCents: 17500,
    })

    const res = await getMine(campaign.slug)

    expect(res.data).toMatchObject({
      plan: 'team',
      planPricingModel: 'one_time',
      planPaidAt: paidAt.toISOString(),
      planEndsAt: '2027-01-05T00:00:00.000Z',
      outreachCreditCents: 17500,
    })
  })

  it('returns a null end date when there is no election date and no override', async () => {
    const campaign = await seedCampaign({}, null)

    const res = await getMine(campaign.slug)

    expect(res.data.planEndsAt).toBeNull()
  })
})

describe('planEndsAt on the M2M GET /v1/campaigns/:id', () => {
  it('returns the staff override, else the election date plus the access window', async () => {
    vi.spyOn<AuthProvider, 'verifyM2MToken'>(
      service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN),
      'verifyM2MToken',
    ).mockResolvedValue({ id: 'mt_test', subject: 'mch_gp_admin' })
    const headers = { Authorization: 'Bearer mt_test' }
    const overridden = await seedCampaign({
      plan: CampaignPlanLevel.pro,
      planEndsAtOverride: new Date('2027-01-05T00:00:00Z'),
    })
    const derived = await seedCampaign()

    const withOverride = await service.client.get(
      `/v1/campaigns/${overridden.id}`,
      { headers },
    )
    const withoutOverride = await service.client.get(
      `/v1/campaigns/${derived.id}`,
      { headers },
    )

    expect(withOverride.data.planEndsAt).toBe('2027-01-05T00:00:00.000Z')
    expect(withoutOverride.data.planEndsAt).toBe('2026-11-17T00:00:00.000Z')
  })
})

describe('plan and credit columns on the M2M PUT /v1/campaigns/:id', () => {
  it('ignores them and still applies the other fields in the body', async () => {
    vi.spyOn<AuthProvider, 'verifyM2MToken'>(
      service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN),
      'verifyM2MToken',
    ).mockResolvedValue({ id: 'mt_test', subject: 'mch_gp_admin' })
    const campaign = await seedCampaign({ outreachCreditCents: 500 })

    const res = await service.client.put(
      `/v1/campaigns/${campaign.id}`,
      {
        isDemo: true,
        plan: 'team',
        planPricingModel: 'one_time',
        planPaidAt: '2026-09-01T15:00:00.000Z',
        planEndedAt: '2026-10-01T15:00:00.000Z',
        outreachCreditCents: 99999,
        hasFreeTextsOffer: true,
      },
      { headers: { Authorization: 'Bearer mt_test' } },
    )

    expect(res.status).toBe(200)
    const after = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(after).toMatchObject({
      isDemo: true,
      plan: 'free',
      planPricingModel: null,
      planPaidAt: null,
      planEndedAt: null,
      outreachCreditCents: 500,
      hasFreeTextsOffer: false,
    })
  })
})

describe('outreach_credit_cents', () => {
  it('rejects a negative balance at the database', async () => {
    const campaign = await seedCampaign()

    await expect(
      service.prisma.campaign.update({
        where: { id: campaign.id },
        data: { outreachCreditCents: -1 },
      }),
    ).rejects.toThrow()
  })
})

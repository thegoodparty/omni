import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
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

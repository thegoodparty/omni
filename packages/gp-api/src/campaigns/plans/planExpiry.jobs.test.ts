import { AnalyticsService } from '@/analytics/analytics.service'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { FeaturesService } from '@/features/services/features.service'
import { CampaignPlanLevel, PlanPricingModel, Prisma } from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { useTestService } from '@/test-service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { addDays, format, subDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = useTestService({ jobs: true })

let seq = 0
const seedPlan = async (
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> & {
    electionDaysAgo?: number | null
  } = {},
) => {
  const { electionDaysAgo = 15, ...rest } = overrides
  seq += 1
  const slug = `plan-expiry-${seq}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      slug,
      organizationSlug: slug,
      userId: service.user.id,
      isPro: true,
      plan: CampaignPlanLevel.pro,
      planPricingModel: PlanPricingModel.one_time,
      outreachCreditCents: 17_500,
      details:
        electionDaysAgo === null
          ? {}
          : {
              electionDate: format(
                subDays(new Date(), electionDaysAgo),
                'yyyy-MM-dd',
              ),
            },
      ...rest,
    },
  })
}

const readCampaign = (id: number) =>
  service.prisma.campaign.findUniqueOrThrow({ where: { id } })

const setSweepFlag = (on: boolean) =>
  vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(on)

const spyOnTrack = () =>
  vi
    .spyOn(service.app.get(AnalyticsService), 'track')
    .mockResolvedValue({ event: 'tracked', userId: 'tracked' })

beforeEach(() => {
  vi.spyOn(
    service.app.get(CrmCampaignsService),
    'trackCampaign',
  ).mockResolvedValue(undefined)
})

describe('planExpirySweep', () => {
  it('never ends a subscriber, backfilled or not, past its election', async () => {
    setSweepFlag(true)
    const backfilled = await seedPlan({
      planPricingModel: PlanPricingModel.subscription,
      outreachCreditCents: 0,
      details: {
        subscriptionId: 'sub_backfilled',
        electionDate: format(subDays(new Date(), 60), 'yyyy-MM-dd'),
      },
    })
    const legacy = await seedPlan({
      plan: CampaignPlanLevel.free,
      planPricingModel: null,
      outreachCreditCents: 0,
      details: {
        subscriptionId: 'sub_legacy',
        electionDate: format(subDays(new Date(), 60), 'yyyy-MM-dd'),
      },
    })

    await service.jobs.runSchedule('planExpirySweep')

    for (const { id } of [backfilled, legacy]) {
      expect(await readCampaign(id)).toMatchObject({
        isPro: true,
        planEndedAt: null,
      })
    }
  })

  it('ends a one-time plan 15 days after the election', async () => {
    setSweepFlag(true)
    const track = spyOnTrack()
    const campaign = await seedPlan({ electionDaysAgo: 15 })

    await service.jobs.runSchedule('planExpirySweep')

    const ended = await readCampaign(campaign.id)
    expect(ended.isPro).toBe(false)
    expect(ended.planEndedAt).toBeInstanceOf(Date)
    expect(ended.outreachCreditCents).toBe(0)
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Account.PaidPlanUpdated,
      {
        plan: CampaignPlanLevel.pro,
        change: 'ended',
        reason: 'election_passed',
        creditExpiredCents: 17_500,
      },
      undefined,
      `plan-ended:${campaign.id}`,
    )
  })

  it('leaves a plan 13 days after the election alone', async () => {
    setSweepFlag(true)
    const campaign = await seedPlan({ electionDaysAgo: 13 })

    await service.jobs.runSchedule('planExpirySweep')

    expect(await readCampaign(campaign.id)).toMatchObject({
      isPro: true,
      planEndedAt: null,
      outreachCreditCents: 17_500,
    })
  })

  it('lets a future override win over a long-past election', async () => {
    setSweepFlag(true)
    const campaign = await seedPlan({
      electionDaysAgo: 90,
      planEndsAtOverride: addDays(new Date(), 5),
    })

    await service.jobs.runSchedule('planExpirySweep')

    expect(await readCampaign(campaign.id)).toMatchObject({
      isPro: true,
      planEndedAt: null,
    })
  })

  it('ends a plan whose override has passed even with a future election', async () => {
    setSweepFlag(true)
    const campaign = await seedPlan({
      electionDaysAgo: -30,
      planEndsAtOverride: subDays(new Date(), 1),
    })

    await service.jobs.runSchedule('planExpirySweep')

    expect((await readCampaign(campaign.id)).isPro).toBe(false)
  })

  it('never selects a grandfathered subscription campaign', async () => {
    setSweepFlag(true)
    const campaign = await seedPlan({
      electionDaysAgo: 60,
      planPricingModel: PlanPricingModel.subscription,
    })

    await service.jobs.runSchedule('planExpirySweep')

    expect(await readCampaign(campaign.id)).toMatchObject({
      isPro: true,
      planEndedAt: null,
      outreachCreditCents: 17_500,
    })
  })

  it('leaves a plan with no election date and no override', async () => {
    setSweepFlag(true)
    const campaign = await seedPlan({ electionDaysAgo: null })

    await service.jobs.runSchedule('planExpirySweep')

    expect((await readCampaign(campaign.id)).isPro).toBe(true)
  })

  it('writes nothing with the sweep flag off', async () => {
    setSweepFlag(false)
    const track = spyOnTrack()
    const campaign = await seedPlan({ electionDaysAgo: 40 })

    await service.jobs.runSchedule('planExpirySweep')

    expect(await readCampaign(campaign.id)).toMatchObject({
      isPro: true,
      planEndedAt: null,
      outreachCreditCents: 17_500,
    })
    expect(track).not.toHaveBeenCalled()
  })

  it('ends each campaign once across two runs', async () => {
    setSweepFlag(true)
    const track = spyOnTrack()
    const campaign = await seedPlan({ electionDaysAgo: 20 })

    await service.jobs.runSchedule('planExpirySweep')
    const first = await readCampaign(campaign.id)
    await service.jobs.runSchedule('planExpirySweep')

    expect(await readCampaign(campaign.id)).toEqual(first)
    expect(track).toHaveBeenCalledTimes(1)
  })

  it('dead-letters the job and leaves the plan due when the plan-end event fails', async () => {
    setSweepFlag(true)
    vi.spyOn(service.app.get(AnalyticsService), 'track').mockRejectedValue(
      new Error('Segment down'),
    )
    const campaign = await seedPlan({ electionDaysAgo: 20 })

    const { deadLetters } = await service.jobs.runSchedule('planExpirySweep', {
      allowDeadLetters: true,
    })

    expect(deadLetters).toEqual([
      {
        name: 'planExpire',
        data: { campaignId: campaign.id },
        error: 'Segment down',
      },
    ])
    expect(await readCampaign(campaign.id)).toMatchObject({
      isPro: true,
      planEndedAt: null,
      outreachCreditCents: 17_500,
    })
  })

  it('re-checks under the lock: a queued job for an extended plan changes nothing', async () => {
    const track = spyOnTrack()
    const campaign = await seedPlan({
      electionDaysAgo: 20,
      planEndsAtOverride: addDays(new Date(), 10),
    })

    await service.app
      .get(JobsService)
      .send('planExpire', { campaignId: campaign.id })
    await service.jobs.settle()

    expect(await readCampaign(campaign.id)).toMatchObject({
      isPro: true,
      planEndedAt: null,
      outreachCreditCents: 17_500,
    })
    expect(track).not.toHaveBeenCalled()
  })

  it('sends no event when an extend lands between the read and the lock', async () => {
    setSweepFlag(true)
    const track = spyOnTrack()
    const campaign = await seedPlan({ electionDaysAgo: 20 })
    const campaigns = service.app.get(CampaignsService)
    const setIsPro = campaigns.setIsPro.bind(campaigns)
    vi.spyOn(campaigns, 'setIsPro').mockImplementationOnce(async (...args) => {
      await service.prisma.campaign.update({
        where: { id: campaign.id },
        data: { planEndsAtOverride: addDays(new Date(), 10) },
      })
      return setIsPro(...args)
    })

    await service.jobs.runSchedule('planExpirySweep')

    expect(await readCampaign(campaign.id)).toMatchObject({
      isPro: true,
      planEndedAt: null,
      outreachCreditCents: 17_500,
    })
    expect(track).not.toHaveBeenCalled()
  })

  it('ends the plan and sends the event once when the retry follows a Segment failure', async () => {
    setSweepFlag(true)
    const track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockRejectedValueOnce(new Error('Segment down'))
      .mockResolvedValue({ event: 'tracked', userId: 'tracked' })
    const campaign = await seedPlan({ electionDaysAgo: 20 })

    await service.jobs.runSchedule('planExpirySweep')

    expect(await readCampaign(campaign.id)).toMatchObject({
      isPro: false,
      outreachCreditCents: 0,
    })
    expect(track).toHaveBeenCalledTimes(2)
  })
})

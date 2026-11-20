import { describe, expect, it } from 'vitest'
import { Prisma } from '../src/generated/prisma'
import { useTestService } from '../src/test-service'
import {
  formatReport,
  run,
  type SqlRunner,
} from './backfill-subscription-plan-columns'

describe('backfill-subscription-plan-columns', () => {
  const service = useTestService()

  const db = (): SqlRunner => ({
    query: <T>(sql: string, params: unknown[]) =>
      service.prisma.$queryRawUnsafe<T[]>(sql, ...params),
  })

  let seq = 0
  const insertCampaign = async (
    overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
  ) => {
    seq += 1
    const slug = `backfill-sub-${seq}-${Math.random().toString(36).slice(2, 8)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    return service.prisma.campaign.create({
      data: {
        slug,
        organizationSlug: slug,
        userId: service.user.id,
        ...overrides,
      },
    })
  }

  const insertLegacySubscriber = (
    overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
  ) =>
    insertCampaign({
      isPro: true,
      outreachCreditCents: 0,
      details: { subscriptionId: 'sub_legacy' },
      ...overrides,
    })

  const read = (id: number) =>
    service.prisma.campaign.findUniqueOrThrow({ where: { id } })

  it('writes nothing on a dry run but reports the subscriber', async () => {
    const { id } = await insertLegacySubscriber()

    const report = await run(db(), { apply: false })

    expect(report.updated).toContain(id)
    expect(await read(id)).toMatchObject({
      plan: 'free',
      planPricingModel: null,
    })
    expect(formatReport(report)).toContain('DRY RUN')
  })

  it('stamps the plan columns once and changes nothing on a re-run', async () => {
    const { id } = await insertLegacySubscriber({ outreachCreditCents: 0 })
    const before = await read(id)

    const first = await run(db(), { apply: true })
    const second = await run(db(), { apply: true })

    expect(first.updated).toContain(id)
    expect(second.updated).not.toContain(id)
    const after = await read(id)
    expect(after).toMatchObject({
      plan: 'pro',
      planPricingModel: 'subscription',
      isPro: true,
      outreachCreditCents: 0,
      planPaidAt: null,
      planEndedAt: null,
    })
    expect(after.details).toEqual(before.details)
  })

  it('leaves non-subscribers and already-stamped rows alone', async () => {
    const noSubscription = await insertCampaign({ isPro: true })
    const blankSubscription = await insertCampaign({
      isPro: true,
      details: { subscriptionId: '' },
    })
    const notPro = await insertCampaign({
      details: { subscriptionId: 'sub_cancelled_flag' },
    })
    const stamped = await insertLegacySubscriber({
      plan: 'pro',
      planPricingModel: 'subscription',
    })

    const report = await run(db(), { apply: true })

    for (const { id } of [noSubscription, blankSubscription, notPro, stamped]) {
      expect(report.updated).not.toContain(id)
    }
    expect(await read(noSubscription.id)).toMatchObject({ plan: 'free' })
    expect(await read(blankSubscription.id)).toMatchObject({ plan: 'free' })
    expect(await read(notPro.id)).toMatchObject({ plan: 'free' })
  })

  it('lists a subscriber that also holds a one-time plan and does not touch it', async () => {
    const { id } = await insertLegacySubscriber({
      plan: 'pro',
      planPricingModel: 'one_time',
    })

    const report = await run(db(), { apply: true })

    expect(report.updated).not.toContain(id)
    expect(report.paidTwice).toContain(id)
    expect(formatReport(report)).toContain(String(id))
    expect(await read(id)).toMatchObject({ planPricingModel: 'one_time' })
  })
})

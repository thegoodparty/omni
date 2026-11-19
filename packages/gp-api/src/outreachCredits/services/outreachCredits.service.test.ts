import { beforeEach, describe, expect, it } from 'vitest'
import { OutreachStatus, OutreachType } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { OutreachCreditsService } from './outreachCredits.service'

const service = useTestService()

let credits: OutreachCreditsService
let campaignId: number
let suffix = 0

const setup = async (balance: number, planEndedAt: Date | null = null) => {
  suffix += 1
  const slug = `credits-${Date.now()}-${suffix}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug,
      organizationSlug: slug,
      outreachCreditCents: balance,
      planEndedAt,
    },
  })
  campaignId = campaign.id
}

const createOutreach = async (): Promise<number> => {
  const outreach = await service.prisma.outreach.create({
    data: {
      campaignId,
      outreachType: OutreachType.p2p,
      status: OutreachStatus.pending,
    },
  })
  return outreach.id
}

const reserve = (outreachId: number, estimate: number) =>
  service.prisma.$transaction((tx) =>
    credits.reserve(tx, campaignId, outreachId, estimate),
  )

const balance = async () =>
  (
    await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    })
  ).outreachCreditCents

beforeEach(() => {
  credits = service.app.get(OutreachCreditsService)
})

describe('reserve', () => {
  it('reserves the estimate when the balance covers it', async () => {
    await setup(17500)
    const id = await createOutreach()

    expect(await reserve(id, 10000)).toBe(10000)
    expect(await balance()).toBe(7500)
    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id },
    })
    expect(row.creditReservedCents).toBe(10000)
  })

  it('reserves only the balance when the estimate is larger', async () => {
    await setup(5000)
    const id = await createOutreach()

    expect(await reserve(id, 10000)).toBe(5000)
    expect(await balance()).toBe(0)
  })

  it('is idempotent for a send that already holds a reserve', async () => {
    await setup(17500)
    const id = await createOutreach()

    await reserve(id, 10000)
    expect(await reserve(id, 10000)).toBe(10000)
    expect(await balance()).toBe(7500)
  })

  it('reserves nothing once the plan has ended', async () => {
    await setup(17500, new Date())
    const id = await createOutreach()

    expect(await reserve(id, 10000)).toBe(0)
    expect(await balance()).toBe(17500)
  })

  it('never overspends when two reserves race for one balance', async () => {
    await setup(10000)
    const first = await createOutreach()
    const second = await createOutreach()

    const results = await Promise.all([
      reserve(first, 10000),
      reserve(second, 10000),
    ])

    expect(results.sort((a, b) => a - b)).toEqual([0, 10000])
    expect(await balance()).toBe(0)
  })
})

describe('settle', () => {
  it('returns the unused part of the reserve to the balance', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)

    expect(await credits.settle(id, 8000)).toEqual({
      creditUsedCents: 8000,
      cardCents: 0,
    })
    expect(await balance()).toBe(9500)
  })

  it('charges the card for cost beyond the reserve', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)

    expect(await credits.settle(id, 12000)).toEqual({
      creditUsedCents: 10000,
      cardCents: 2000,
    })
    expect(await balance()).toBe(7500)
  })

  it('drops the remainder when the plan has ended', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: { planEndedAt: new Date() },
    })

    await credits.settle(id, 8000)
    expect(await balance()).toBe(7500)
  })

  it('changes nothing on a second call', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)

    await credits.settle(id, 8000)
    expect(await credits.settle(id, 8000)).toEqual({
      creditUsedCents: 8000,
      cardCents: 0,
    })
    expect(await balance()).toBe(9500)
  })

  it('stamps the send as settled', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)
    await credits.settle(id, 8000)

    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id },
    })
    expect(row.creditSettledAt).not.toBeNull()
  })
})

describe('release', () => {
  it('returns the whole reserve', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)

    await credits.release(id)
    expect(await balance()).toBe(17500)
  })

  it('drops the reserve when the plan has ended', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: { planEndedAt: new Date() },
    })

    await credits.release(id)
    expect(await balance()).toBe(7500)
  })

  it('changes nothing on a second call, or after a settle', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)

    await credits.release(id)
    await credits.release(id)
    await credits.settle(id, 5000)
    expect(await balance()).toBe(17500)
  })
})

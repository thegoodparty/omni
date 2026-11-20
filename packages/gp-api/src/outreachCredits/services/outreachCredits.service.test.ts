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

  it('bills the card in full for a settle that follows a release', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)

    await credits.release(id)
    expect(await credits.settle(id, 5000)).toEqual({
      creditUsedCents: 0,
      cardCents: 5000,
    })
    expect(await reserve(id, 10000)).toBe(0)
    expect(await balance()).toBe(17500)
  })
})

describe('unreserve', () => {
  it('returns the reserve without closing the send, so a later reserve works', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)

    expect(await credits.unreserve(id)).toBe(10000)
    expect(await balance()).toBe(17500)
    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id },
    })
    expect(row.creditReservedCents).toBe(0)
    expect(row.creditSettledAt).toBeNull()
    expect(await reserve(id, 6000)).toBe(6000)
    expect(await balance()).toBe(11500)
  })

  it('returns the reserve once when called twice', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)

    await Promise.all([credits.unreserve(id), credits.unreserve(id)])
    expect(await balance()).toBe(17500)
  })

  it('moves nothing for a send that already settled or was released', async () => {
    await setup(17500)
    const settled = await createOutreach()
    await reserve(settled, 10000)
    await credits.settle(settled, 4000)
    const released = await createOutreach()
    await reserve(released, 2000)
    await credits.release(released)

    expect(await credits.unreserve(settled)).toBe(0)
    expect(await credits.unreserve(released)).toBe(0)
    expect(await balance()).toBe(13500)
  })

  it('drops the reserve when the plan has ended', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: { planEndedAt: new Date() },
    })

    await credits.unreserve(id)
    expect(await balance()).toBe(7500)
  })
})

describe('refundUsed', () => {
  it('gives back the credit a settled send used, once', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)
    await credits.settle(id, 8000)
    expect(await balance()).toBe(9500)

    expect(await credits.refundUsed(id)).toBe(8000)
    expect(await credits.refundUsed(id)).toBe(0)
    await Promise.all([credits.refundUsed(id), credits.refundUsed(id)])
    expect(await balance()).toBe(17500)
  })

  it('returns what the send used, not the reserve it started with', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)
    await credits.settle(id, 3000)

    await credits.refundUsed(id)
    expect(await balance()).toBe(17500)
    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id },
    })
    expect(row.creditUsedCents).toBe(3000)
  })

  it('gives nothing back for a send that was never settled or was released', async () => {
    await setup(17500)
    const reserved = await createOutreach()
    await reserve(reserved, 10000)
    const released = await createOutreach()
    await reserve(released, 2000)
    await credits.release(released)

    expect(await credits.refundUsed(reserved)).toBe(0)
    expect(await credits.refundUsed(released)).toBe(0)
    expect(await balance()).toBe(17500 - 10000)
  })

  it('drops the credit when the plan has ended', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)
    await credits.settle(id, 8000)
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: { planEndedAt: new Date() },
    })

    await credits.refundUsed(id)
    expect(await balance()).toBe(9500)
  })

  it('rolls the claim back with the caller transaction', async () => {
    await setup(17500)
    const id = await createOutreach()
    await reserve(id, 10000)
    await credits.settle(id, 8000)

    await expect(
      service.prisma.$transaction(async (tx) => {
        await credits.refundUsed(id, tx)
        throw new Error('later step failed')
      }),
    ).rejects.toThrow('later step failed')

    expect(await balance()).toBe(9500)
    expect(await credits.refundUsed(id)).toBe(8000)
    expect(await balance()).toBe(17500)
  })
})

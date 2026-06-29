import { useTestService } from '@/test-service'
import { Prisma } from '@/generated/prisma'
import { describe, expect, it } from 'vitest'

const service = useTestService()

const OPPONENT = 'Jane Rival'

const seedCampaign = async () => {
  const slug = 'summary-model'
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${slug}-campaign`,
      organizationSlug: slug,
      isPro: true,
    },
  })
}

describe('RaceOpponentSummary model', () => {
  it('upserts one row per (campaignId, opponentName)', async () => {
    const campaign = await seedCampaign()
    const where = {
      campaignId_opponentName: {
        campaignId: campaign.id,
        opponentName: OPPONENT,
      },
    }

    const created = await service.prisma.raceOpponentSummary.upsert({
      where,
      create: {
        campaignId: campaign.id,
        opponentName: OPPONENT,
        sections: { overview: { text: 'first', source_url: 'https://a' } },
        runId: 'run-1',
      },
      update: {},
    })

    const updated = await service.prisma.raceOpponentSummary.upsert({
      where,
      create: {
        campaignId: campaign.id,
        opponentName: OPPONENT,
        sections: {},
        runId: 'run-1',
      },
      update: {
        sections: { overview: { text: 'second', source_url: 'https://b' } },
        runId: 'run-2',
      },
    })

    expect(updated.id).toBe(created.id)
    expect(updated.runId).toBe('run-2')

    const rows = await service.prisma.raceOpponentSummary.findMany({
      where: { campaignId: campaign.id },
    })
    expect(rows).toHaveLength(1)
  })

  it('rejects a duplicate (campaignId, opponentName) insert', async () => {
    const campaign = await seedCampaign()
    const data = {
      campaignId: campaign.id,
      opponentName: OPPONENT,
      sections: { overview: { text: 'x', source_url: 'https://a' } },
    }

    await service.prisma.raceOpponentSummary.create({ data })

    await expect(
      service.prisma.raceOpponentSummary.create({ data }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
  })
})

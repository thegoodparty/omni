import { useTestService } from '@/test-service'
import { Prisma } from '@/generated/prisma'
import { describe, expect, it } from 'vitest'

const service = useTestService()

const seedCampaign = async (slug: string) => {
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

describe('RaceOpponentFieldAnalysis model', () => {
  it('upserts one row per campaignId', async () => {
    const campaign = await seedCampaign('field-analysis-model')
    const where = { campaignId: campaign.id }

    const created = await service.prisma.raceOpponentFieldAnalysis.upsert({
      where,
      create: {
        campaignId: campaign.id,
        sections: { strengths: { text: 'first', source_url: 'https://a' } },
        runId: 'run-1',
      },
      update: {},
    })

    const updated = await service.prisma.raceOpponentFieldAnalysis.upsert({
      where,
      create: {
        campaignId: campaign.id,
        sections: {},
        runId: 'run-1',
      },
      update: {
        sections: { strengths: { text: 'second', source_url: 'https://b' } },
        runId: 'run-2',
      },
    })

    expect(updated.id).toBe(created.id)
    expect(updated.runId).toBe('run-2')

    const rows = await service.prisma.raceOpponentFieldAnalysis.findMany({
      where: { campaignId: campaign.id },
    })
    expect(rows).toHaveLength(1)
  })

  it('rejects a duplicate campaignId insert', async () => {
    const campaign = await seedCampaign('field-analysis-dup')
    const data = {
      campaignId: campaign.id,
      sections: { strengths: { text: 'x', source_url: 'https://a' } },
    }

    await service.prisma.raceOpponentFieldAnalysis.create({ data })

    await expect(
      service.prisma.raceOpponentFieldAnalysis.create({ data }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
  })

  it('deletes the row when its campaign is deleted', async () => {
    const campaign = await seedCampaign('field-analysis-cascade')
    await service.prisma.raceOpponentFieldAnalysis.create({
      data: {
        campaignId: campaign.id,
        sections: { strengths: { text: 'x', source_url: 'https://a' } },
      },
    })

    await service.prisma.campaign.delete({ where: { id: campaign.id } })

    const rows = await service.prisma.raceOpponentFieldAnalysis.findMany({
      where: { campaignId: campaign.id },
    })
    expect(rows).toHaveLength(0)
  })
})

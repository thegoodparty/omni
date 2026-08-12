import { useTestService } from '@/test-service'
import { describe, expect, it } from 'vitest'
import { CampaignsService } from './campaigns.service'

const KNOWN_ELECTION_DATE = '2025-11-03'

const service = useTestService()

describe('CampaignsService.fetchLiveRaceTargetMetrics (election-api integration)', () => {
  it('returns null when org has no positionId and no overrideDistrictId', async () => {
    const org = await service.prisma.organization.create({
      data: {
        slug: 'no-position-org',
        ownerId: service.user.id,
        positionId: null,
      },
    })

    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'no-position-campaign',
        organizationSlug: org.slug,
        details: { electionDate: KNOWN_ELECTION_DATE },
      },
    })

    const campaignsService = service.app.get(CampaignsService)
    const fullCampaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })

    const metrics =
      await campaignsService.fetchLiveRaceTargetMetrics(fullCampaign)

    expect(metrics).toBeNull()
  })

  it('returns null when org has overrideDistrictId but no matching turnout', async () => {
    const org = await service.prisma.organization.create({
      data: {
        slug: 'override-no-turnout-org',
        ownerId: service.user.id,
        positionId: null,
        overrideDistrictId: 'nonexistent-district-uuid',
      },
    })

    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'override-no-turnout-campaign',
        organizationSlug: org.slug,
        details: { electionDate: KNOWN_ELECTION_DATE },
      },
    })

    const campaignsService = service.app.get(CampaignsService)
    const fullCampaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })

    const metrics =
      await campaignsService.fetchLiveRaceTargetMetrics(fullCampaign)

    expect(metrics).toBeNull()
  })

  it('returns null when campaign has no electionDate', async () => {
    const org = await service.prisma.organization.create({
      data: {
        slug: 'no-date-org',
        ownerId: service.user.id,
        positionId: 'some-uuid',
      },
    })

    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'no-date-campaign',
        organizationSlug: org.slug,
        details: {},
      },
    })

    const campaignsService = service.app.get(CampaignsService)
    const fullCampaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })

    const metrics =
      await campaignsService.fetchLiveRaceTargetMetrics(fullCampaign)

    expect(metrics).toBeNull()
  })

  it('returns null when campaign has no organization', async () => {
    const org = await service.prisma.organization.create({
      data: {
        slug: 'dummy-org-for-no-org-test',
        ownerId: service.user.id,
      },
    })

    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'no-org-campaign',
        organizationSlug: org.slug,
        details: { electionDate: KNOWN_ELECTION_DATE },
      },
    })

    const campaignsService = service.app.get(CampaignsService)
    const fullCampaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })

    const metrics = await campaignsService.fetchLiveRaceTargetMetrics({
      ...fullCampaign,
      // This test intentionally simulates a campaign with no org
      organizationSlug: null as unknown as string,
    })

    expect(metrics).toBeNull()
  })

  it('returns null when election-api returns no turnout data', async () => {
    const org = await service.prisma.organization.create({
      data: {
        slug: 'bad-position-org',
        ownerId: service.user.id,
        positionId: 'nonexistent-position-uuid',
      },
    })

    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'bad-position-campaign',
        organizationSlug: org.slug,
        details: { electionDate: KNOWN_ELECTION_DATE },
      },
    })

    const campaignsService = service.app.get(CampaignsService)
    const fullCampaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })

    const metrics =
      await campaignsService.fetchLiveRaceTargetMetrics(fullCampaign)

    expect(metrics).toBeNull()
  })
})

import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { isActiveCampaign } from '@/campaigns/util/eligibility.util'
import { useTestService } from '@/test-service'
import { InternalServerErrorException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

const service = useTestService()

const seedCampaign = async () => {
  const org = await service.prisma.organization.create({
    data: { slug: 'campaign-org-update', ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: 'update-run',
      details: { state: 'CA' },
      organizationSlug: org.slug,
    },
  })
  return { org, campaign }
}

describe('PUT /v1/campaigns/mine (updateJsonFields)', () => {
  it('deep-merges json details, persists, and returns the campaign', async () => {
    const { org, campaign } = await seedCampaign()
    const crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)

    const result = await service.client.put(
      '/v1/campaigns/mine',
      { details: { city: 'Oakland' } },
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(200)
    expect(result.data.id).toBe(campaign.id)
    expect(result.data.details).toMatchObject({
      state: 'CA',
      city: 'Oakland',
    })

    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.details).toMatchObject({ state: 'CA', city: 'Oakland' })
  })

  it('tracks the campaign in the CRM on a successful update', async () => {
    const { org, campaign } = await seedCampaign()
    const crm = service.app.get(CrmCampaignsService)
    const trackSpy = vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)

    const result = await service.client.put(
      '/v1/campaigns/mine',
      { details: { city: 'Oakland' } },
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(200)
    expect(trackSpy).toHaveBeenCalledWith(campaign.id)
  })
})

describe('PUT /v1/campaigns/mine — stale election-result reset (ENG-10954)', () => {
  // A re-running candidate reuses their campaign: didWin / primaryResult /
  // details.wonGeneral recorded for the prior race permanently fail
  // isActiveCampaign on the new race unless cleared when the election date
  // moves to a new upcoming date.
  const seedRerunCampaign = async (
    details: PrismaJson.CampaignDetails = {
      state: 'CA',
      electionDate: '2024-11-05',
      primaryElectionDate: '2024-03-05',
      wonGeneral: false,
    },
  ) => {
    const org = await service.prisma.organization.create({
      data: { slug: 'campaign-org-rerun', ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'rerun-candidate',
        didWin: false,
        primaryResult: 'lost',
        details,
        organizationSlug: org.slug,
      },
    })
    return { org, campaign }
  }

  const mockCrm = () => {
    const crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)
  }

  const putMine = (
    orgSlug: string,
    details: Partial<PrismaJson.CampaignDetails>,
  ) =>
    service.client.put(
      '/v1/campaigns/mine',
      { details },
      { headers: { 'x-organization-slug': orgSlug } },
    )

  it('clears prior-race results when electionDate moves to an upcoming date', async () => {
    const { org, campaign } = await seedRerunCampaign()
    mockCrm()

    const result = await putMine(org.slug, { electionDate: '2030-11-05' })

    expect(result.status).toBe(200)
    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.didWin).toBeNull()
    expect(persisted.primaryResult).toBeNull()
    expect(persisted.details).toMatchObject({
      state: 'CA',
      electionDate: '2030-11-05',
    })
    expect(persisted.details).not.toHaveProperty('wonGeneral')
    expect(persisted.details).not.toHaveProperty('primaryElectionDate')
    expect(isActiveCampaign(persisted, new Date())).toBe(true)
  })

  it('keeps recorded results when details change without the election date', async () => {
    const { org, campaign } = await seedRerunCampaign()
    mockCrm()

    const result = await putMine(org.slug, { occupation: 'Teacher' })

    expect(result.status).toBe(200)
    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.didWin).toBe(false)
    expect(persisted.primaryResult).toBe('lost')
    expect(persisted.details).toMatchObject({
      occupation: 'Teacher',
      wonGeneral: false,
      primaryElectionDate: '2024-03-05',
    })
  })

  it('keeps recorded results when the same election date is re-sent', async () => {
    const { org, campaign } = await seedRerunCampaign()
    mockCrm()

    await putMine(org.slug, {
      electionDate: '2024-11-05',
      occupation: 'Teacher',
    })

    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.didWin).toBe(false)
    expect(persisted.primaryResult).toBe('lost')
    expect(persisted.details).toMatchObject({ wonGeneral: false })
  })

  it('does not reset when the new election date is already past', async () => {
    const { org, campaign } = await seedRerunCampaign()
    mockCrm()

    await putMine(org.slug, { electionDate: '2024-01-02' })

    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.didWin).toBe(false)
    expect(persisted.primaryResult).toBe('lost')
  })

  it('keeps a primaryElectionDate supplied by the same update', async () => {
    const { org, campaign } = await seedRerunCampaign()
    mockCrm()

    await putMine(org.slug, {
      electionDate: '2030-11-05',
      primaryElectionDate: '2030-03-05',
    })

    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.didWin).toBeNull()
    expect(persisted.details).toMatchObject({
      primaryElectionDate: '2030-03-05',
    })
    expect(persisted.details).not.toHaveProperty('wonGeneral')
  })

  it('does not reset on callers that omit the opt-in (admin M2M path)', async () => {
    const { campaign } = await seedRerunCampaign()
    mockCrm()
    const campaigns = service.app.get(CampaignsService)

    await campaigns.updateJsonFields(campaign.id, {
      details: { electionDate: '2030-11-05' },
    })

    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.didWin).toBe(false)
    expect(persisted.primaryResult).toBe('lost')
    expect(persisted.details).toMatchObject({
      electionDate: '2030-11-05',
      wonGeneral: false,
    })
  })
})

describe('CampaignsService.updateJsonFields — update did not resolve', () => {
  it('throws and does not track when the campaign is missing', async () => {
    const campaigns = service.app.get(CampaignsService)
    const crm = service.app.get(CrmCampaignsService)
    const trackSpy = vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)

    await expect(
      campaigns.updateJsonFields(999_999, { details: { city: 'Nowhere' } }),
    ).rejects.toBeInstanceOf(InternalServerErrorException)

    expect(trackSpy).not.toHaveBeenCalled()
  })
})

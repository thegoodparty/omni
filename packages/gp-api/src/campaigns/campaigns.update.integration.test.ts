import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
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

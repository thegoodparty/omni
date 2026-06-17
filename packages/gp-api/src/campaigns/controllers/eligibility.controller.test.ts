import { useTestService } from '@/test-service'
import { describe, expect, it } from 'vitest'

const service = useTestService()

describe('GET /v1/eligibility', () => {
  it('returns the full Eligibility shape for a user with nothing', async () => {
    const result = await service.client.get('/v1/eligibility')

    expect(result).toMatchObject({
      status: 200,
      data: {
        hasActiveCampaign: false,
        holdsOffice: false,
        canStartCampaign: true,
        canGainOffice: true,
        reelectionOfficeSlug: null,
      },
    })
  })

  it('blocks starting a campaign when the user has an active run', async () => {
    await service.prisma.organization.create({
      data: { slug: 'campaign-900', ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'active-run',
        details: { electionDate: '2099-11-03' },
        organizationSlug: 'campaign-900',
      },
    })

    await service.prisma.organization.create({
      data: { slug: 'eo-ended-900', ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-ended-900',
        userId: service.user.id,
        isActive: true,
        termEndDate: new Date('2000-01-01'),
      },
    })

    const result = await service.client.get('/v1/eligibility')

    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({
      hasActiveCampaign: true,
      canStartCampaign: false,
      holdsOffice: false,
      canGainOffice: true,
    })
  })

  it('blocks gaining an office when the user holds one, and allows a new run', async () => {
    await service.prisma.organization.create({
      data: { slug: 'eo-held-900', ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-held-900',
        userId: service.user.id,
        isActive: true,
        termEndDate: null,
      },
    })

    const result = await service.client.get('/v1/eligibility')

    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({
      holdsOffice: true,
      canGainOffice: false,
      hasActiveCampaign: false,
      canStartCampaign: true,
      reelectionOfficeSlug: 'eo-held-900',
    })
  })
})

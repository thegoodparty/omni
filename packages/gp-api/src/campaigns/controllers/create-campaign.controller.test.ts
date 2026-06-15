import { useTestService } from '@/test-service'
import { describe, expect, it } from 'vitest'

const service = useTestService()

describe('POST /v1/campaigns', () => {
  it('returns 409 when the user already has an active campaign', async () => {
    await service.prisma.organization.create({
      data: { slug: 'campaign-1', ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'active-run',
        organizationSlug: 'campaign-1',
        details: { electionDate: '2099-11-03' },
      },
    })

    const result = await service.client.post('/v1/campaigns', {
      details: { state: 'CA' },
    })

    expect(result.status).toBe(409)

    const campaignCount = await service.prisma.campaign.count({
      where: { userId: service.user.id },
    })
    expect(campaignCount).toBe(1)
  })
})

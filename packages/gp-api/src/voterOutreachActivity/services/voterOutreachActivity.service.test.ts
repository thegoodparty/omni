import { useTestService } from '@/test-service'
import {
  OutreachType,
  VoterOutreachAttributionSource,
} from '@/generated/prisma'
import { beforeEach, describe, expect, it } from 'vitest'
import { VoterOutreachActivityService } from './voterOutreachActivity.service'

const service = useTestService()

describe('VoterOutreachActivityService', () => {
  let activities: VoterOutreachActivityService

  const seedCampaign = async (slug: string) => {
    await service.prisma.organization.create({
      data: { slug: `org-${slug}`, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug,
        organizationSlug: `org-${slug}`,
      },
    })
    return campaign.id
  }

  beforeEach(() => {
    activities = service.app.get(VoterOutreachActivityService)
  })

  it('persists a record and reads it back by campaign + voter', async () => {
    const campaignId = await seedCampaign('campaign-a')

    const created = await activities.recordActivity({
      campaignId,
      lalVoterId: 'LAL-123',
      outreachType: OutreachType.doorKnocking,
      attributionSource: VoterOutreachAttributionSource.recipient,
      occurredAt: new Date('2026-03-01T12:00:00.000Z'),
      metadata: { canvasser: 'jane' },
    })

    expect(created.id).toBeDefined()
    expect(created.attributionSource).toBe(
      VoterOutreachAttributionSource.recipient,
    )

    const result = await activities.getActivityForVoter(campaignId, 'LAL-123')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      campaignId,
      lalVoterId: 'LAL-123',
      outreachType: OutreachType.doorKnocking,
      attributionSource: VoterOutreachAttributionSource.recipient,
      metadata: { canvasser: 'jane' },
    })
  })

  it('returns a voter timeline ordered by occurredAt, newest first', async () => {
    const campaignId = await seedCampaign('campaign-b')

    await activities.recordActivity({
      campaignId,
      lalVoterId: 'LAL-9',
      outreachType: OutreachType.text,
      attributionSource: VoterOutreachAttributionSource.segmentDerived,
      occurredAt: new Date('2026-01-10T00:00:00.000Z'),
    })
    await activities.recordActivity({
      campaignId,
      lalVoterId: 'LAL-9',
      outreachType: OutreachType.robocall,
      attributionSource: VoterOutreachAttributionSource.segmentDerived,
      occurredAt: new Date('2026-04-15T00:00:00.000Z'),
    })
    await activities.recordActivity({
      campaignId,
      lalVoterId: 'LAL-9',
      outreachType: OutreachType.p2p,
      attributionSource: VoterOutreachAttributionSource.recipient,
      occurredAt: new Date('2026-02-20T00:00:00.000Z'),
    })

    const result = await activities.getActivityForVoter(campaignId, 'LAL-9')

    expect(result.map((a) => a.occurredAt)).toEqual([
      new Date('2026-04-15T00:00:00.000Z'),
      new Date('2026-02-20T00:00:00.000Z'),
      new Date('2026-01-10T00:00:00.000Z'),
    ])
  })

  it('scopes the query to the requested campaign and voter', async () => {
    const campaignId = await seedCampaign('campaign-c')
    const otherCampaignId = await seedCampaign('campaign-d')

    await activities.recordActivity({
      campaignId,
      lalVoterId: 'LAL-match',
      outreachType: OutreachType.phoneBanking,
      attributionSource: VoterOutreachAttributionSource.segmentDerived,
      occurredAt: new Date('2026-05-01T00:00:00.000Z'),
    })
    // Same voter id, different campaign — must not leak.
    await activities.recordActivity({
      campaignId: otherCampaignId,
      lalVoterId: 'LAL-match',
      outreachType: OutreachType.phoneBanking,
      attributionSource: VoterOutreachAttributionSource.segmentDerived,
      occurredAt: new Date('2026-05-01T00:00:00.000Z'),
    })
    // Same campaign, different voter — must not leak.
    await activities.recordActivity({
      campaignId,
      lalVoterId: 'LAL-other',
      outreachType: OutreachType.socialMedia,
      attributionSource: VoterOutreachAttributionSource.segmentDerived,
      occurredAt: new Date('2026-05-02T00:00:00.000Z'),
    })

    const result = await activities.getActivityForVoter(campaignId, 'LAL-match')

    expect(result).toHaveLength(1)
    expect(result[0].campaignId).toBe(campaignId)
    expect(result[0].lalVoterId).toBe('LAL-match')
  })
})

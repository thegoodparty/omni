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
    expect(result[0]?.campaignId).toBe(campaignId)
    expect(result[0]?.lalVoterId).toBe('LAL-match')
  })

  it('bounds the page with take and pages forward with the id cursor', async () => {
    const campaignId = await seedCampaign('campaign-e')

    const seed = (occurredAt: string) =>
      activities.recordActivity({
        campaignId,
        lalVoterId: 'LAL-page',
        outreachType: OutreachType.text,
        attributionSource: VoterOutreachAttributionSource.segmentDerived,
        occurredAt: new Date(occurredAt),
      })
    await seed('2026-01-01T00:00:00.000Z')
    await seed('2026-02-01T00:00:00.000Z')
    await seed('2026-03-01T00:00:00.000Z')

    const firstTwo = await activities.getActivityForVoter(
      campaignId,
      'LAL-page',
      2,
    )
    expect(firstTwo).toHaveLength(2)
    expect(firstTwo.map((a) => a.occurredAt)).toEqual([
      new Date('2026-03-01T00:00:00.000Z'),
      new Date('2026-02-01T00:00:00.000Z'),
    ])

    const afterSecond = await activities.getActivityForVoter(
      campaignId,
      'LAL-page',
      2,
      String(firstTwo[1]?.id),
    )
    expect(afterSecond.map((a) => a.occurredAt)).toEqual([
      new Date('2026-01-01T00:00:00.000Z'),
    ])
  })

  it('returns an empty page for a non-numeric cursor', async () => {
    const campaignId = await seedCampaign('campaign-f')
    await activities.recordActivity({
      campaignId,
      lalVoterId: 'LAL-nan',
      outreachType: OutreachType.text,
      attributionSource: VoterOutreachAttributionSource.segmentDerived,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const result = await activities.getActivityForVoter(
      campaignId,
      'LAL-nan',
      2,
      'not-a-number',
    )

    expect(result).toEqual([])
  })

  it('returns an empty page for a cursor belonging to another voter', async () => {
    const campaignId = await seedCampaign('campaign-g')
    const foreign = await activities.recordActivity({
      campaignId,
      lalVoterId: 'LAL-foreign',
      outreachType: OutreachType.text,
      attributionSource: VoterOutreachAttributionSource.segmentDerived,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await activities.recordActivity({
      campaignId,
      lalVoterId: 'LAL-target',
      outreachType: OutreachType.text,
      attributionSource: VoterOutreachAttributionSource.segmentDerived,
      occurredAt: new Date('2026-02-01T00:00:00.000Z'),
    })

    const result = await activities.getActivityForVoter(
      campaignId,
      'LAL-target',
      2,
      String(foreign.id),
    )

    expect(result).toEqual([])
  })

  it('upserts idempotently on (campaign, type, sourceId) so a retry never duplicates', async () => {
    const campaignId = await seedCampaign('campaign-idempotent')

    const write = (lalVoterId: string) =>
      activities.recordActivityIdempotent({
        campaignId,
        lalVoterId,
        outreachType: OutreachType.doorKnocking,
        attributionSource: VoterOutreachAttributionSource.recipient,
        occurredAt: new Date('2026-03-01T12:00:00.000Z'),
        sourceId: 'interaction-55',
      })

    const first = await write('LAL-a')
    const second = await write('LAL-b')

    // Same source event id → same row id, mutable fields refreshed.
    expect(second.id).toBe(first.id)
    expect(second.lalVoterId).toBe('LAL-b')

    const rows = await activities.findMany({ where: { campaignId } })
    expect(rows).toHaveLength(1)

    const sourceIds = await activities.findSourceIds(
      campaignId,
      OutreachType.doorKnocking,
    )
    expect(sourceIds).toEqual(new Set(['interaction-55']))
  })
})

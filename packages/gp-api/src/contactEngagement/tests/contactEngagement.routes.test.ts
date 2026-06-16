import { useTestService } from '@/test-service'
import {
  Campaign,
  OutreachType,
  VoterOutreachAttributionSource,
} from '../../generated/prisma'
import { FeaturesService } from '@/features/services/features.service'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConstituentActivityType } from '../contactEngagement.types'

const service = useTestService()

describe('ContactEngagement routes', () => {
  let campaign: Campaign
  let campaignOrgSlug: string
  const lalVoterId = 'LAL-VOTER-1'

  beforeEach(async () => {
    const suffix = Date.now()
    campaignOrgSlug = `campaign-${suffix}`
    await service.prisma.organization.create({
      data: { slug: campaignOrgSlug, ownerId: service.user.id },
    })
    campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `test-campaign-${suffix}`,
        organizationSlug: campaignOrgSlug,
      },
    })

    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
  })

  describe('GET /contact-engagement/:id/activities (campaign context)', () => {
    it('returns the campaign outreach activities for a voter, newest first', async () => {
      await service.prisma.voterOutreachActivity.createMany({
        data: [
          {
            campaignId: campaign.id,
            lalVoterId,
            outreachType: OutreachType.doorKnocking,
            attributionSource: VoterOutreachAttributionSource.recipient,
            occurredAt: new Date('2026-01-10T10:00:00Z'),
          },
          {
            campaignId: campaign.id,
            lalVoterId,
            outreachType: OutreachType.text,
            attributionSource: VoterOutreachAttributionSource.segmentDerived,
            occurredAt: new Date('2026-02-20T10:00:00Z'),
          },
        ],
      })

      const result = await service.client.get(
        `/v1/contact-engagement/${lalVoterId}/activities`,
        { headers: { 'x-organization-slug': campaignOrgSlug } },
      )

      expect(result.status).toBe(200)
      expect(result.data.results).toHaveLength(2)
      expect(result.data.results[0]).toMatchObject({
        type: ConstituentActivityType.OUTREACH,
        date: '2026-02-20T10:00:00.000Z',
        data: {
          outreachType: OutreachType.text,
          attributionSource: VoterOutreachAttributionSource.segmentDerived,
        },
      })
      expect(result.data.results[1]).toMatchObject({
        type: ConstituentActivityType.OUTREACH,
        date: '2026-01-10T10:00:00.000Z',
        data: { outreachType: OutreachType.doorKnocking },
      })
    })

    it('pages forward with the activityId cursor', async () => {
      await service.prisma.voterOutreachActivity.createMany({
        data: [
          {
            campaignId: campaign.id,
            lalVoterId,
            outreachType: OutreachType.doorKnocking,
            attributionSource: VoterOutreachAttributionSource.recipient,
            occurredAt: new Date('2026-01-10T10:00:00Z'),
          },
          {
            campaignId: campaign.id,
            lalVoterId,
            outreachType: OutreachType.phoneBanking,
            attributionSource: VoterOutreachAttributionSource.segmentDerived,
            occurredAt: new Date('2026-02-15T10:00:00Z'),
          },
          {
            campaignId: campaign.id,
            lalVoterId,
            outreachType: OutreachType.text,
            attributionSource: VoterOutreachAttributionSource.segmentDerived,
            occurredAt: new Date('2026-03-20T10:00:00Z'),
          },
        ],
      })

      const page1 = await service.client.get(
        `/v1/contact-engagement/${lalVoterId}/activities`,
        {
          params: { take: 2 },
          headers: { 'x-organization-slug': campaignOrgSlug },
        },
      )

      expect(page1.status).toBe(200)
      expect(page1.data.results).toHaveLength(2)
      expect(page1.data.results[0].date).toBe('2026-03-20T10:00:00.000Z')
      expect(page1.data.results[1].date).toBe('2026-02-15T10:00:00.000Z')
      expect(page1.data.nextCursor).not.toBeNull()

      const page2 = await service.client.get(
        `/v1/contact-engagement/${lalVoterId}/activities`,
        {
          params: { take: 2, after: page1.data.nextCursor },
          headers: { 'x-organization-slug': campaignOrgSlug },
        },
      )

      expect(page2.status).toBe(200)
      expect(page2.data.results).toHaveLength(1)
      expect(page2.data.results[0].date).toBe('2026-01-10T10:00:00.000Z')
      expect(page2.data.nextCursor).toBeNull()
    })

    it('returns an empty page for a stale cursor instead of looping', async () => {
      await service.prisma.voterOutreachActivity.create({
        data: {
          campaignId: campaign.id,
          lalVoterId,
          outreachType: OutreachType.doorKnocking,
          attributionSource: VoterOutreachAttributionSource.recipient,
          occurredAt: new Date('2026-01-10T10:00:00Z'),
        },
      })

      const result = await service.client.get(
        `/v1/contact-engagement/${lalVoterId}/activities`,
        {
          params: { after: '999999' },
          headers: { 'x-organization-slug': campaignOrgSlug },
        },
      )

      expect(result.status).toBe(200)
      expect(result.data.results).toEqual([])
      expect(result.data.nextCursor).toBeNull()
    })

    it('does not return another campaign activities for the same voter', async () => {
      const otherOrgSlug = `campaign-other-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherOrgSlug, ownerId: service.user.id },
      })
      const otherCampaign = await service.prisma.campaign.create({
        data: {
          userId: service.user.id,
          slug: `other-campaign-${Date.now()}`,
          organizationSlug: otherOrgSlug,
        },
      })
      await service.prisma.voterOutreachActivity.create({
        data: {
          campaignId: otherCampaign.id,
          lalVoterId,
          outreachType: OutreachType.p2p,
          attributionSource: VoterOutreachAttributionSource.recipient,
          occurredAt: new Date('2026-03-01T10:00:00Z'),
        },
      })

      const result = await service.client.get(
        `/v1/contact-engagement/${lalVoterId}/activities`,
        { headers: { 'x-organization-slug': campaignOrgSlug } },
      )

      expect(result.status).toBe(200)
      expect(result.data.results).toEqual([])
    })

    it('rejects with 403 when the win-voter-data flag is off', async () => {
      vi.spyOn(
        service.app.get(FeaturesService),
        'isFeatureEnabled',
      ).mockResolvedValue(false)

      const result = await service.client.get(
        `/v1/contact-engagement/${lalVoterId}/activities`,
        { headers: { 'x-organization-slug': campaignOrgSlug } },
      )

      expect(result.status).toBe(403)
    })

    it('rejects with 404 when the org is owned by another user', async () => {
      const otherUser = await service.prisma.user.create({
        data: {
          email: 'other-engagement@goodparty.org',
          firstName: 'Other',
          lastName: 'User',
        },
      })
      const otherOrgSlug = `campaign-foreign-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherOrgSlug, ownerId: otherUser.id },
      })
      await service.prisma.campaign.create({
        data: {
          userId: otherUser.id,
          slug: `foreign-campaign-${Date.now()}`,
          organizationSlug: otherOrgSlug,
        },
      })

      const result = await service.client.get(
        `/v1/contact-engagement/${lalVoterId}/activities`,
        { headers: { 'x-organization-slug': otherOrgSlug } },
      )

      expect(result.status).toBe(404)
    })
  })

  describe('GET /contact-engagement/:id/activities (elected office context)', () => {
    it('returns poll interactions for the elected office, unchanged', async () => {
      const eoOrgSlug = `eo-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: eoOrgSlug, ownerId: service.user.id },
      })
      const electedOffice = await service.prisma.electedOffice.create({
        data: {
          userId: service.user.id,
          campaignId: campaign.id,
          organizationSlug: eoOrgSlug,
        },
      })
      const poll = await service.prisma.poll.create({
        data: {
          name: 'Community Survey',
          messageContent: 'How are things?',
          targetAudienceSize: 100,
          scheduledDate: new Date('2026-01-01T00:00:00Z'),
          estimatedCompletionDate: new Date('2026-01-05T00:00:00Z'),
          electedOfficeId: electedOffice.id,
        },
      })
      await service.prisma.pollIndividualMessage.create({
        data: {
          id: `pim-${Date.now()}`,
          personId: 'person-123',
          electedOfficeId: electedOffice.id,
          pollId: poll.id,
          sentAt: new Date('2026-01-02T10:00:00Z'),
        },
      })

      const result = await service.client.get(
        '/v1/contact-engagement/person-123/activities',
        { headers: { 'x-organization-slug': eoOrgSlug } },
      )

      expect(result.status).toBe(200)
      expect(result.data.results).toHaveLength(1)
      expect(result.data.results[0]).toMatchObject({
        type: ConstituentActivityType.POLL_INTERACTIONS,
        data: { pollId: poll.id, pollTitle: 'Community Survey' },
      })
    })
  })
})

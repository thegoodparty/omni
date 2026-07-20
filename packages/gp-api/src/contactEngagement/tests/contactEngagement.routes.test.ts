import { useTestService } from '@/test-service'
import {
  Campaign,
  DoorKnockOutcome,
  OutreachType,
  SupportAnswer,
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

  describe('GET /contact-engagement/:id/activities (campaign context - Win)', () => {
    it('unions door knocks, texts, robocalls, notes, and legacy outreach rows when lalVoterId is given, newest first', async () => {
      const personId = 'person-win-1'

      await service.prisma.contactInteractionRobocall.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          occurredAt: new Date('2026-01-04T10:00:00Z'),
          voicemailLeftAt: new Date('2026-01-04T10:05:00Z'),
          manual: false,
        },
      })
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          occurredAt: new Date('2026-01-05T10:00:00Z'),
          outcome: DoorKnockOutcome.answered,
          supportAnswer: SupportAnswer.supporter,
          note: 'Great chat on the porch',
          manual: true,
        },
      })
      await service.prisma.contactInteractionText.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          occurredAt: new Date('2026-01-06T10:00:00Z'),
          respondedAt: new Date('2026-01-06T11:00:00Z'),
          manual: false,
        },
      })
      await service.prisma.contactNote.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          body: 'Follow up before the primary',
          createdAt: new Date('2026-01-07T10:00:00Z'),
        },
      })
      await service.prisma.voterOutreachActivity.create({
        data: {
          campaignId: campaign.id,
          lalVoterId,
          outreachType: OutreachType.text,
          attributionSource: VoterOutreachAttributionSource.segmentDerived,
          occurredAt: new Date('2026-01-08T10:00:00Z'),
        },
      })

      const result = await service.client.get(
        `/v1/contact-engagement/${personId}/activities`,
        {
          params: { lalVoterId },
          headers: { 'x-organization-slug': campaignOrgSlug },
        },
      )

      expect(result.status).toBe(200)
      expect(result.data.results.map((r: { type: string }) => r.type)).toEqual([
        ConstituentActivityType.OUTREACH,
        ConstituentActivityType.NOTE,
        ConstituentActivityType.TEXT,
        ConstituentActivityType.DOOR_KNOCK,
        ConstituentActivityType.ROBOCALL,
      ])

      const [outreach, note, text, doorKnock, robocall] = result.data.results

      expect(outreach.data).toMatchObject({
        outreachType: OutreachType.text,
        attributionSource: VoterOutreachAttributionSource.segmentDerived,
      })
      expect(note.data).toMatchObject({
        body: 'Follow up before the primary',
      })
      expect(text.data).toMatchObject({
        respondedAt: '2026-01-06T11:00:00.000Z',
        optedOutAt: null,
        manual: false,
        outreachId: null,
      })
      expect(doorKnock.data).toMatchObject({
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.supporter,
        note: 'Great chat on the porch',
        manual: true,
      })
      expect(robocall.data).toMatchObject({
        answeredAt: null,
        voicemailLeftAt: '2026-01-04T10:05:00.000Z',
        outreachId: null,
      })
    })

    it('omits legacy outreach rows when lalVoterId is not given, without erroring', async () => {
      const personId = 'person-win-2'

      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          occurredAt: new Date('2026-01-05T10:00:00Z'),
          outcome: DoorKnockOutcome.not_home,
          manual: true,
        },
      })
      await service.prisma.voterOutreachActivity.create({
        data: {
          campaignId: campaign.id,
          lalVoterId: 'LAL-VOTER-2',
          outreachType: OutreachType.doorKnocking,
          attributionSource: VoterOutreachAttributionSource.recipient,
          occurredAt: new Date('2026-01-06T10:00:00Z'),
        },
      })

      const result = await service.client.get(
        `/v1/contact-engagement/${personId}/activities`,
        { headers: { 'x-organization-slug': campaignOrgSlug } },
      )

      expect(result.status).toBe(200)
      expect(result.data.results).toHaveLength(1)
      expect(result.data.results[0]).toMatchObject({
        type: ConstituentActivityType.DOOR_KNOCK,
      })
    })

    it('paginates the union without duplicates or gaps (cursor walk, page size 2)', async () => {
      const personId = 'person-win-cursor'
      const cursorLalVoterId = 'LAL-CURSOR-1'

      await service.prisma.contactInteractionRobocall.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          occurredAt: new Date('2026-01-01T10:00:00Z'),
          manual: false,
        },
      })
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          occurredAt: new Date('2026-01-02T10:00:00Z'),
          outcome: DoorKnockOutcome.refused_to_engage,
          manual: true,
        },
      })
      await service.prisma.contactInteractionText.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          occurredAt: new Date('2026-01-03T10:00:00Z'),
          manual: false,
        },
      })
      await service.prisma.contactNote.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          body: 'Cursor walk note',
          createdAt: new Date('2026-01-04T10:00:00Z'),
        },
      })
      await service.prisma.voterOutreachActivity.create({
        data: {
          campaignId: campaign.id,
          lalVoterId: cursorLalVoterId,
          outreachType: OutreachType.doorKnocking,
          attributionSource: VoterOutreachAttributionSource.recipient,
          occurredAt: new Date('2026-01-05T10:00:00Z'),
        },
      })

      const seenTypes: string[] = []
      let after: string | undefined
      let pages = 0

      do {
        const page = await service.client.get(
          `/v1/contact-engagement/${personId}/activities`,
          {
            params: {
              take: 2,
              lalVoterId: cursorLalVoterId,
              ...(after ? { after } : {}),
            },
            headers: { 'x-organization-slug': campaignOrgSlug },
          },
        )
        expect(page.status).toBe(200)
        seenTypes.push(
          ...page.data.results.map((r: { type: string }) => r.type),
        )
        after = page.data.nextCursor ?? undefined
        pages += 1
      } while (after && pages < 10)

      expect(pages).toBe(3)
      expect(seenTypes).toEqual([
        ConstituentActivityType.OUTREACH,
        ConstituentActivityType.NOTE,
        ConstituentActivityType.TEXT,
        ConstituentActivityType.DOOR_KNOCK,
        ConstituentActivityType.ROBOCALL,
      ])
      // No duplicates across pages.
      expect(new Set(seenTypes).size).toBe(seenTypes.length)
    }, 10000)

    it('terminates without duplicates or drops when 3+ rows share one occurredAt, including numeric OUTREACH id ordering (same-day tie group)', async () => {
      // Win outreach attribution sets occurredAt from a date-only picker, so
      // same-day rows can carry a byte-identical midnight timestamp. A cursor
      // keyed on date alone would resume on the first row of the tie group
      // every time — infinite "View more" loop, re-served duplicates, older
      // rows never reached. This asserts the walk actually terminates.
      const personId = 'person-win-tie'
      const tieOccurredAt = new Date('2026-03-01T00:00:00Z')
      const tieLalVoterId = 'LAL-TIE-1'

      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          occurredAt: tieOccurredAt,
          outcome: DoorKnockOutcome.answered,
          manual: true,
        },
      })
      await service.prisma.contactInteractionText.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          occurredAt: tieOccurredAt,
          manual: false,
        },
      })
      await service.prisma.contactInteractionRobocall.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          occurredAt: tieOccurredAt,
          manual: false,
        },
      })
      // Explicit (not auto-increment-assigned) ids so the numeric-vs-string
      // divergence is guaranteed: '10' and '100' both sort before '9' as
      // strings, but the DB (and the fix) order them 100, 10, 9.
      for (const id of [9, 10, 100]) {
        await service.prisma.voterOutreachActivity.create({
          data: {
            id,
            campaignId: campaign.id,
            lalVoterId: tieLalVoterId,
            outreachType: OutreachType.text,
            attributionSource: VoterOutreachAttributionSource.segmentDerived,
            occurredAt: tieOccurredAt,
          },
        })
      }

      const seen: { type: string; activityId: string | number }[] = []
      let after: string | undefined
      let pages = 0

      do {
        const page = await service.client.get(
          `/v1/contact-engagement/${personId}/activities`,
          {
            params: {
              take: 2,
              lalVoterId: tieLalVoterId,
              ...(after ? { after } : {}),
            },
            headers: { 'x-organization-slug': campaignOrgSlug },
          },
        )
        expect(page.status).toBe(200)
        seen.push(
          ...page.data.results.map(
            (r: { type: string; data: { activityId: string | number } }) => ({
              type: r.type,
              activityId: r.data.activityId,
            }),
          ),
        )
        after = page.data.nextCursor ?? undefined
        pages += 1
      } while (after && pages < 10)

      expect(pages).toBe(3)
      expect(seen.map((s) => s.type)).toEqual([
        ConstituentActivityType.DOOR_KNOCK,
        ConstituentActivityType.OUTREACH,
        ConstituentActivityType.OUTREACH,
        ConstituentActivityType.OUTREACH,
        ConstituentActivityType.ROBOCALL,
        ConstituentActivityType.TEXT,
      ])
      // Numeric-descending order (100, 10, 9) — a string tiebreak would give
      // [10, 100, 9] instead.
      const outreachIds = seen
        .filter((s) => s.type === ConstituentActivityType.OUTREACH)
        .map((s) => s.activityId)
      expect(outreachIds).toEqual([100, 10, 9])
      // No duplicates and nothing dropped.
      expect(seen).toHaveLength(6)
      expect(new Set(seen.map((s) => `${s.type}:${s.activityId}`)).size).toBe(6)
    }, 10000)

    it('does not truncate a feed where one source has far more rows than the page size', async () => {
      // Each per-source fetch is bounded to `take: limit + 1` rows (a person's
      // feed can otherwise be unbounded — e.g. years of door-knock attempts).
      // This walks deep enough (page size 2, 7 rows) that page 3+ only works
      // if the bounded "before cursorDate" re-fetch on each page correctly
      // finds the next window instead of silently truncating after page 1.
      const personId = 'person-win-deep-page'
      const rowCount = 7

      for (let day = 1; day <= rowCount; day++) {
        await service.prisma.contactInteractionDoorKnock.create({
          data: {
            organizationSlug: campaignOrgSlug,
            personId,
            occurredAt: new Date(
              `2026-01-${String(day).padStart(2, '0')}T10:00:00Z`,
            ),
            outcome: DoorKnockOutcome.answered,
            manual: true,
          },
        })
      }

      const seenIds: string[] = []
      let after: string | undefined
      let pages = 0

      do {
        const page = await service.client.get(
          `/v1/contact-engagement/${personId}/activities`,
          {
            params: { take: 2, ...(after ? { after } : {}) },
            headers: { 'x-organization-slug': campaignOrgSlug },
          },
        )
        expect(page.status).toBe(200)
        seenIds.push(
          ...page.data.results.map(
            (r: { data: { activityId: string } }) => r.data.activityId,
          ),
        )
        after = page.data.nextCursor ?? undefined
        pages += 1
      } while (after && pages < 10)

      expect(pages).toBe(4)
      expect(seenIds).toHaveLength(rowCount)
      // No duplicates and nothing dropped.
      expect(new Set(seenIds).size).toBe(rowCount)
    }, 10000)

    it('returns an empty page for a stale/foreign cursor instead of restarting from page 1', async () => {
      // A cursor that matches no row in the current union — its activity was
      // deleted between requests, or it's simply foreign/stale — must not be
      // treated as "start over": that would re-serve page 1 forever in
      // infinite scroll (findIndex -1 landing on startIndex 0).
      const personId = 'person-win-stale-cursor'

      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          occurredAt: new Date('2026-01-05T10:00:00Z'),
          outcome: DoorKnockOutcome.answered,
          manual: true,
        },
      })

      const result = await service.client.get(
        `/v1/contact-engagement/${personId}/activities`,
        {
          params: {
            after: '2099-01-01T00:00:00.000Z|NOTE|does-not-exist',
          },
          headers: { 'x-organization-slug': campaignOrgSlug },
        },
      )

      expect(result.status).toBe(200)
      expect(result.data.results).toEqual([])
      expect(result.data.nextCursor).toBeNull()
    })

    it('does not return another org/campaign interactions, notes, or outreach rows', async () => {
      const personId = 'person-win-isolated'
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
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: otherOrgSlug,
          personId,
          occurredAt: new Date('2026-01-05T10:00:00Z'),
          outcome: DoorKnockOutcome.answered,
          manual: true,
        },
      })
      await service.prisma.contactNote.create({
        data: {
          organizationSlug: otherOrgSlug,
          personId,
          body: 'Belongs to the other org',
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
        `/v1/contact-engagement/${personId}/activities`,
        {
          params: { lalVoterId },
          headers: { 'x-organization-slug': campaignOrgSlug },
        },
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
        `/v1/contact-engagement/person-flag-off/activities`,
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
        '/v1/contact-engagement/person-foreign/activities',
        { headers: { 'x-organization-slug': otherOrgSlug } },
      )

      expect(result.status).toBe(404)
    })

    it('rejects with 404 when the X-Organization-Slug header is absent', async () => {
      const result = await service.client.get(
        '/v1/contact-engagement/person-no-header/activities',
      )

      expect(result.status).toBe(404)
    })
  })

  describe('GET /contact-engagement/:id/activities (elected office context - Serve)', () => {
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

    it('unions poll interactions with door knocks, texts, robocalls, and notes, newest first', async () => {
      const eoOrgSlug = `eo-union-${Date.now()}`
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
          name: 'Neighborhood Survey',
          messageContent: 'How are things?',
          targetAudienceSize: 100,
          scheduledDate: new Date('2026-01-01T00:00:00Z'),
          estimatedCompletionDate: new Date('2026-01-05T00:00:00Z'),
          electedOfficeId: electedOffice.id,
        },
      })
      const personId = 'person-serve-union'

      await service.prisma.pollIndividualMessage.create({
        data: {
          id: `pim-union-${Date.now()}`,
          personId,
          electedOfficeId: electedOffice.id,
          pollId: poll.id,
          sentAt: new Date('2026-01-08T10:00:00Z'),
        },
      })
      await service.prisma.contactNote.create({
        data: {
          organizationSlug: eoOrgSlug,
          personId,
          body: 'Constituent follow-up',
          createdAt: new Date('2026-01-07T10:00:00Z'),
        },
      })
      await service.prisma.contactInteractionText.create({
        data: {
          organizationSlug: eoOrgSlug,
          personId,
          occurredAt: new Date('2026-01-06T10:00:00Z'),
          manual: false,
        },
      })
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: eoOrgSlug,
          personId,
          occurredAt: new Date('2026-01-05T10:00:00Z'),
          outcome: DoorKnockOutcome.answered,
          supportAnswer: SupportAnswer.unsure,
          manual: true,
        },
      })
      await service.prisma.contactInteractionRobocall.create({
        data: {
          organizationSlug: eoOrgSlug,
          personId,
          occurredAt: new Date('2026-01-04T10:00:00Z'),
          manual: false,
        },
      })

      const result = await service.client.get(
        `/v1/contact-engagement/${personId}/activities`,
        { headers: { 'x-organization-slug': eoOrgSlug } },
      )

      expect(result.status).toBe(200)
      expect(result.data.results.map((r: { type: string }) => r.type)).toEqual([
        ConstituentActivityType.POLL_INTERACTIONS,
        ConstituentActivityType.NOTE,
        ConstituentActivityType.TEXT,
        ConstituentActivityType.DOOR_KNOCK,
        ConstituentActivityType.ROBOCALL,
      ])
    })

    it('does not return another org interactions or notes', async () => {
      const eoOrgSlug = `eo-isolated-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: eoOrgSlug, ownerId: service.user.id },
      })
      await service.prisma.electedOffice.create({
        data: {
          userId: service.user.id,
          campaignId: campaign.id,
          organizationSlug: eoOrgSlug,
        },
      })
      const personId = 'person-serve-isolated'

      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: campaignOrgSlug,
          personId,
          occurredAt: new Date('2026-01-05T10:00:00Z'),
          outcome: DoorKnockOutcome.answered,
          manual: true,
        },
      })

      const result = await service.client.get(
        `/v1/contact-engagement/${personId}/activities`,
        { headers: { 'x-organization-slug': eoOrgSlug } },
      )

      expect(result.status).toBe(200)
      expect(result.data.results).toEqual([])
      // Sanity: the row exists, just under a different org.
      const rows = await service.prisma.contactInteractionDoorKnock.findMany({
        where: { organizationSlug: campaignOrgSlug, personId },
      })
      expect(rows).toHaveLength(1)
    })
  })

  describe('GET /contact-engagement/:id/issues', () => {
    it('returns empty issues for a campaign context', async () => {
      const result = await service.client.get(
        `/v1/contact-engagement/${lalVoterId}/issues`,
        { headers: { 'x-organization-slug': campaignOrgSlug } },
      )

      expect(result.status).toBe(200)
      expect(result.data).toEqual({ nextCursor: null, results: [] })
    })

    it('returns constituent issues for an elected office', async () => {
      const suffix = Date.now()
      const eoOrgSlug = `eo-issues-${suffix}`
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
          name: 'Issues Survey',
          messageContent: 'What matters to you?',
          targetAudienceSize: 50,
          scheduledDate: new Date('2026-03-01T00:00:00Z'),
          estimatedCompletionDate: new Date('2026-03-05T00:00:00Z'),
          electedOfficeId: electedOffice.id,
        },
      })
      // A constituent message linked to a poll issue is the only shape
      // getConstituentIssues returns — a non-empty result the campaign
      // early-return path can never produce, so this can't pass tautologically.
      await service.prisma.pollIndividualMessage.create({
        data: {
          id: `pim-issues-${suffix}`,
          personId: 'person-456',
          electedOfficeId: electedOffice.id,
          pollId: poll.id,
          sender: 'CONSTITUENT',
          sentAt: new Date('2026-03-02T10:00:00Z'),
          pollIssues: {
            create: {
              id: `issue-${suffix}`,
              pollId: poll.id,
              title: 'Housing',
              summary: 'Affordable housing',
              details: 'Constituents want more affordable housing',
              mentionCount: 1,
            },
          },
        },
      })

      const result = await service.client.get(
        '/v1/contact-engagement/person-456/issues',
        { headers: { 'x-organization-slug': eoOrgSlug } },
      )

      expect(result.status).toBe(200)
      expect(result.data.results).toHaveLength(1)
      expect(result.data.results[0]).toMatchObject({
        issueTitle: 'Housing',
        pollTitle: 'Issues Survey',
        pollId: poll.id,
      })
    })
  })
})

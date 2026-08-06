import {
  OutreachType,
  PollIndividualMessageSender,
  VoterOutreachAttributionSource,
} from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConstituentActivityEventType,
  ConstituentActivityType,
  PollConstituentActivity,
} from '../contactEngagement.types'
import { IndividualActivityInput } from '../contactEngagement.schema'
import { ContactEngagementService } from '../contactEngagement.service'
import { PollIndividualMessageService } from '@/polls/services/pollIndividualMessage.service'
import { VoterOutreachActivityService } from '@/voterOutreachActivity/services/voterOutreachActivity.service'
import { ContactInteractionDoorKnockService } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactInteractionRobocallService } from '@/contactInteraction/services/contactInteractionRobocall.service'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'

describe('ContactEngagementService', () => {
  describe('getIndividualActivities', () => {
    let service: ContactEngagementService
    let mockPollIndividualMessageService: {
      findMany: ReturnType<typeof vi.fn>
    }
    let mockContactInteractionDoorKnockService: {
      findMany: ReturnType<typeof vi.fn>
    }
    let mockContactInteractionTextService: {
      findMany: ReturnType<typeof vi.fn>
    }
    let mockContactInteractionRobocallService: {
      findMany: ReturnType<typeof vi.fn>
    }
    let mockVoterOutreachActivityService: {
      getActivityForVoter: ReturnType<typeof vi.fn>
      findMany: ReturnType<typeof vi.fn>
    }
    let mockContactStatusService: {
      findEventsForFeed: ReturnType<typeof vi.fn>
    }

    beforeEach(() => {
      mockPollIndividualMessageService = {
        findMany: vi.fn().mockResolvedValue([]),
      }
      mockContactInteractionDoorKnockService = {
        findMany: vi.fn().mockResolvedValue([]),
      }
      mockContactInteractionTextService = {
        findMany: vi.fn().mockResolvedValue([]),
      }
      mockContactInteractionRobocallService = {
        findMany: vi.fn().mockResolvedValue([]),
      }
      mockVoterOutreachActivityService = {
        getActivityForVoter: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      }
      mockContactStatusService = {
        findEventsForFeed: vi.fn().mockResolvedValue([]),
      }

      // Direct instantiation (not the mock-object-plus-prototype-bind style
      // the other describe blocks use) — getPollActivities is a private
      // helper now, so a real instance is needed to exercise it through the
      // public getIndividualActivities method.
      service = new ContactEngagementService(
        mockPollIndividualMessageService as unknown as PollIndividualMessageService,
        mockVoterOutreachActivityService as unknown as VoterOutreachActivityService,
        mockContactInteractionDoorKnockService as unknown as ContactInteractionDoorKnockService,
        mockContactInteractionTextService as unknown as ContactInteractionTextService,
        mockContactInteractionRobocallService as unknown as ContactInteractionRobocallService,
        mockContactStatusService as unknown as ContactStatusService,
      )
    })

    const baseInput: IndividualActivityInput = {
      personId: 'person-123',
      organizationSlug: 'eo-office-123',
      electedOfficeId: 'office-123',
      take: 20,
    }

    it('returns poll interactions grouped by poll', async () => {
      // Messages returned in descending order by sentAt (newest first, matching query)
      const mockMessages = [
        {
          id: 'msg-2',
          pollId: 'poll-1',
          personId: 'person-123',
          sender: PollIndividualMessageSender.CONSTITUENT,
          isOptOut: false,
          sentAt: new Date('2025-01-15T12:00:00Z'),
          poll: {
            id: 'poll-1',
            name: 'Community Survey',
            createdAt: new Date('2025-01-01T00:00:00Z'),
          },
        },
        {
          id: 'msg-1',
          pollId: 'poll-1',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-15T10:00:00Z'),
          poll: {
            id: 'poll-1',
            name: 'Community Survey',
            createdAt: new Date('2025-01-01T00:00:00Z'),
          },
        },
      ]

      mockPollIndividualMessageService.findMany.mockResolvedValue(mockMessages)

      const result = await service.getIndividualActivities(baseInput)

      expect(mockPollIndividualMessageService.findMany).toHaveBeenCalledWith({
        where: {
          electedOfficeId: 'office-123',
          personId: 'person-123',
        },
        include: {
          poll: true,
        },
        orderBy: { sentAt: 'desc' },
      })

      // No extra item returned, so nextCursor is null
      expect(result.nextCursor).toBeNull()
      expect(result.results).toHaveLength(1)
      // Events should be in chronological order (oldest first)
      // Activity date is the first message's sentAt (newest first in query order)
      expect(result.results[0]).toEqual({
        type: ConstituentActivityType.POLL_INTERACTIONS,
        date: '2025-01-15T12:00:00.000Z',
        data: {
          pollId: 'poll-1',
          pollTitle: 'Community Survey',
          events: [
            {
              type: ConstituentActivityEventType.SENT,
              date: '2025-01-15T10:00:00.000Z',
            },
            {
              type: ConstituentActivityEventType.RESPONDED,
              date: '2025-01-15T12:00:00.000Z',
            },
          ],
        },
      })
    })

    it('returns multiple poll activities when messages span multiple polls', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          pollId: 'poll-1',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-15T10:00:00Z'),
          poll: {
            id: 'poll-1',
            name: 'Poll One',
            createdAt: new Date('2025-01-01T00:00:00Z'),
          },
        },
        {
          id: 'msg-2',
          pollId: 'poll-2',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-20T10:00:00Z'),
          poll: {
            id: 'poll-2',
            name: 'Poll Two',
            createdAt: new Date('2025-01-10T00:00:00Z'),
          },
        },
      ]

      mockPollIndividualMessageService.findMany.mockResolvedValue(mockMessages)

      const result = await service.getIndividualActivities(baseInput)
      // Only poll messages are mocked in this describe block, so every
      // result is a poll activity — narrow for the data.pollId access below.
      const pollResults = result.results as PollConstituentActivity[]

      expect(result.results).toHaveLength(2)
      expect(pollResults.map((r) => r.data.pollId)).toContain('poll-1')
      expect(pollResults.map((r) => r.data.pollId)).toContain('poll-2')
    })

    it('returns polls newest first with events oldest first within each poll', async () => {
      // Messages returned in descending order by sentAt (newest first, matching query)
      // Poll 2 (newer poll) has messages on Jan 20, Poll 1 (older poll) has messages on Jan 15
      const mockMessages = [
        // Poll 2's newest message first
        {
          id: 'msg-4',
          pollId: 'poll-2',
          personId: 'person-123',
          sender: PollIndividualMessageSender.CONSTITUENT,
          isOptOut: false,
          sentAt: new Date('2025-01-20T14:00:00Z'),
          poll: {
            id: 'poll-2',
            name: 'Newer Poll',
            createdAt: new Date('2025-01-18T00:00:00Z'),
          },
        },
        {
          id: 'msg-3',
          pollId: 'poll-2',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-20T10:00:00Z'),
          poll: {
            id: 'poll-2',
            name: 'Newer Poll',
            createdAt: new Date('2025-01-18T00:00:00Z'),
          },
        },
        // Poll 1's messages (older poll)
        {
          id: 'msg-2',
          pollId: 'poll-1',
          personId: 'person-123',
          sender: PollIndividualMessageSender.CONSTITUENT,
          isOptOut: false,
          sentAt: new Date('2025-01-15T12:00:00Z'),
          poll: {
            id: 'poll-1',
            name: 'Older Poll',
            createdAt: new Date('2025-01-01T00:00:00Z'),
          },
        },
        {
          id: 'msg-1',
          pollId: 'poll-1',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-15T10:00:00Z'),
          poll: {
            id: 'poll-1',
            name: 'Older Poll',
            createdAt: new Date('2025-01-01T00:00:00Z'),
          },
        },
      ]

      mockPollIndividualMessageService.findMany.mockResolvedValue(mockMessages)

      const result = await service.getIndividualActivities(baseInput)
      const pollResults = result.results as PollConstituentActivity[]

      expect(result.results).toHaveLength(2)

      // Polls should be in order of first encounter (newest messages first = poll-2 first)
      expect(pollResults[0]?.data.pollId).toBe('poll-2')
      expect(pollResults[1]?.data.pollId).toBe('poll-1')

      // Events within poll-2 should be oldest first
      expect(pollResults[0]?.data.events).toEqual([
        {
          type: ConstituentActivityEventType.SENT,
          date: '2025-01-20T10:00:00.000Z',
        },
        {
          type: ConstituentActivityEventType.RESPONDED,
          date: '2025-01-20T14:00:00.000Z',
        },
      ])

      // Events within poll-1 should be oldest first
      expect(pollResults[1]?.data.events).toEqual([
        {
          type: ConstituentActivityEventType.SENT,
          date: '2025-01-15T10:00:00.000Z',
        },
        {
          type: ConstituentActivityEventType.RESPONDED,
          date: '2025-01-15T12:00:00.000Z',
        },
      ])
    })

    it('correctly identifies opted-out events', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          pollId: 'poll-1',
          personId: 'person-123',
          sender: PollIndividualMessageSender.CONSTITUENT,
          isOptOut: true,
          sentAt: new Date('2025-01-15T10:00:00Z'),
          poll: {
            id: 'poll-1',
            name: 'Community Survey',
            createdAt: new Date('2025-01-01T00:00:00Z'),
          },
        },
      ]

      mockPollIndividualMessageService.findMany.mockResolvedValue(mockMessages)

      const result = await service.getIndividualActivities(baseInput)
      const pollResults = result.results as PollConstituentActivity[]

      expect(pollResults[0]?.data.events[0]?.type).toBe(
        ConstituentActivityEventType.OPTED_OUT,
      )
    })

    it('returns empty results when nothing is found in any source', async () => {
      const result = await service.getIndividualActivities(baseInput)

      expect(result.nextCursor).toBeNull()
      expect(result.results).toEqual([])
    })

    it('uses custom take value when provided', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          pollId: 'poll-1',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-15T10:00:00Z'),
          poll: {
            id: 'poll-1',
            name: 'Community Survey',
            createdAt: new Date('2025-01-01T00:00:00Z'),
          },
        },
      ]

      mockPollIndividualMessageService.findMany.mockResolvedValue(mockMessages)

      const inputWithTake = {
        ...baseInput,
        take: 50,
      }

      const result = await service.getIndividualActivities(inputWithTake)

      expect(mockPollIndividualMessageService.findMany).toHaveBeenCalledWith({
        where: {
          electedOfficeId: 'office-123',
          personId: 'person-123',
        },
        include: { poll: true },
        orderBy: { sentAt: 'desc' },
      })
      expect(result.results).toHaveLength(1)
    })

    it('uses cursor for pagination when after is provided', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          pollId: 'poll-1',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-20T10:00:00Z'),
          poll: {
            id: 'poll-1',
            name: 'Poll One',
            createdAt: new Date('2025-01-01T00:00:00Z'),
          },
        },
        {
          id: 'msg-2',
          pollId: 'poll-2',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-15T10:00:00Z'),
          poll: {
            id: 'poll-2',
            name: 'Poll Two',
            createdAt: new Date('2025-01-05T00:00:00Z'),
          },
        },
      ]

      mockPollIndividualMessageService.findMany.mockResolvedValue(mockMessages)

      const inputWithAfter = {
        ...baseInput,
        take: 1,
        // Cursor is the previous page's last row's composite sort key
        // (date|type|id), not the bare date.
        after: '2025-01-20T10:00:00.000Z|POLL_INTERACTIONS|poll-1',
      }

      const result = await service.getIndividualActivities(inputWithAfter)

      expect(mockPollIndividualMessageService.findMany).toHaveBeenCalledWith({
        where: {
          electedOfficeId: 'office-123',
          personId: 'person-123',
        },
        include: { poll: true },
        orderBy: { sentAt: 'desc' },
      })
      expect(result.results).toHaveLength(1)
      expect((result.results[0] as PollConstituentActivity)?.data.pollId).toBe(
        'poll-2',
      )
    })

    it('returns nextCursor when more results exist', async () => {
      // With take=2, 3 poll groups are produced (desc: poll-3, poll-2,
      // poll-1); the returned page is [poll-3, poll-2], so the cursor is the
      // last *returned* row's date (poll-2), not the oversampled poll-1.
      const mockMessages = [
        {
          id: 'msg-1',
          pollId: 'poll-1',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-15T10:00:00Z'),
          poll: {
            id: 'poll-1',
            name: 'Poll One',
            createdAt: new Date('2025-01-01T00:00:00Z'),
          },
        },
        {
          id: 'msg-2',
          pollId: 'poll-2',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-15T12:00:00Z'),
          poll: {
            id: 'poll-2',
            name: 'Poll Two',
            createdAt: new Date('2025-01-05T00:00:00Z'),
          },
        },
        {
          id: 'msg-3',
          pollId: 'poll-3',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-20T10:00:00Z'),
          poll: {
            id: 'poll-3',
            name: 'Poll Three',
            createdAt: new Date('2025-01-10T00:00:00Z'),
          },
        },
      ]

      mockPollIndividualMessageService.findMany.mockResolvedValue(mockMessages)

      const inputWithTake = { ...baseInput, take: 2 }
      const result = await service.getIndividualActivities(inputWithTake)

      expect(result.nextCursor).toBe(
        '2025-01-15T12:00:00.000Z|POLL_INTERACTIONS|poll-2',
      )
      expect(result.results).toHaveLength(2)
    })

    it('returns null nextCursor when data is exhausted', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          pollId: 'poll-1',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-15T10:00:00Z'),
          poll: {
            id: 'poll-1',
            name: 'Poll One',
            createdAt: new Date('2025-01-01T00:00:00Z'),
          },
        },
        {
          id: 'msg-2',
          pollId: 'poll-2',
          personId: 'person-123',
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          isOptOut: false,
          sentAt: new Date('2025-01-20T10:00:00Z'),
          poll: {
            id: 'poll-2',
            name: 'Poll Two',
            createdAt: new Date('2025-01-10T00:00:00Z'),
          },
        },
      ]

      mockPollIndividualMessageService.findMany.mockResolvedValue(mockMessages)

      const inputWithTake = { ...baseInput, take: 2 }
      const result = await service.getIndividualActivities(inputWithTake)

      expect(result.nextCursor).toBeNull()
      expect(result.results).toHaveLength(2)
    })

    it('skips the poll query entirely for a campaign (no electedOfficeId)', async () => {
      const campaignInput: IndividualActivityInput = {
        personId: 'person-123',
        organizationSlug: 'campaign-org-1',
        campaignId: 7,
        take: 20,
      }

      const result = await service.getIndividualActivities(campaignInput)

      expect(mockPollIndividualMessageService.findMany).not.toHaveBeenCalled()
      expect(result.results).toEqual([])
    })

    it('unions in legacy VoterOutreachActivity rows only when lalVoterId is given', async () => {
      mockVoterOutreachActivityService.findMany.mockResolvedValue([
        {
          id: 2,
          occurredAt: new Date('2026-02-20T10:00:00Z'),
          outreachType: OutreachType.text,
          attributionSource: VoterOutreachAttributionSource.segmentDerived,
        },
      ])

      const campaignInput: IndividualActivityInput = {
        personId: 'person-123',
        organizationSlug: 'campaign-org-1',
        campaignId: 7,
        lalVoterId: 'LAL-1',
        take: 20,
      }

      const result = await service.getIndividualActivities(campaignInput)

      expect(mockVoterOutreachActivityService.findMany).toHaveBeenCalledWith({
        where: { campaignId: 7, lalVoterId: 'LAL-1' },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 21,
      })
      expect(result.results).toEqual([
        {
          type: ConstituentActivityType.OUTREACH,
          date: '2026-02-20T10:00:00.000Z',
          data: {
            activityId: 2,
            outreachType: OutreachType.text,
            attributionSource: VoterOutreachAttributionSource.segmentDerived,
          },
        },
      ])
    })

    it('omits legacy outreach rows for a campaign request without lalVoterId', async () => {
      const campaignInput: IndividualActivityInput = {
        personId: 'person-123',
        organizationSlug: 'campaign-org-1',
        campaignId: 7,
        take: 20,
      }

      const result = await service.getIndividualActivities(campaignInput)

      expect(mockVoterOutreachActivityService.findMany).not.toHaveBeenCalled()
      expect(result.results).toEqual([])
    })

    it('maps door knock, text, and robocall rows into the union', async () => {
      mockContactInteractionDoorKnockService.findMany.mockResolvedValue([
        {
          id: 'dk-1',
          occurredAt: new Date('2026-01-01T10:00:00Z'),
          outcome: 'answered',
          supportAnswer: 'supporter',
          note: 'Friendly chat',
          manual: true,
        },
      ])
      mockContactInteractionTextService.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          occurredAt: new Date('2026-01-02T10:00:00Z'),
          respondedAt: new Date('2026-01-02T11:00:00Z'),
          optedOutAt: null,
          note: null,
          manual: false,
          outreachId: 55,
        },
      ])
      mockContactInteractionRobocallService.findMany.mockResolvedValue([
        {
          id: 'rc-1',
          occurredAt: new Date('2026-01-03T10:00:00Z'),
          answeredAt: null,
          voicemailLeftAt: new Date('2026-01-03T10:05:00Z'),
          note: null,
          manual: false,
          outreachId: 56,
        },
      ])
      const campaignInput: IndividualActivityInput = {
        personId: 'person-123',
        organizationSlug: 'campaign-org-1',
        campaignId: 7,
        take: 20,
      }

      const result = await service.getIndividualActivities(campaignInput)

      const expectedOrderBy = [{ occurredAt: 'desc' }, { id: 'desc' }]
      expect(
        mockContactInteractionDoorKnockService.findMany,
      ).toHaveBeenCalledWith({
        where: { organizationSlug: 'campaign-org-1', personId: 'person-123' },
        orderBy: expectedOrderBy,
        take: 21,
      })
      expect(mockContactInteractionTextService.findMany).toHaveBeenCalledWith({
        where: { organizationSlug: 'campaign-org-1', personId: 'person-123' },
        orderBy: expectedOrderBy,
        take: 21,
      })
      expect(
        mockContactInteractionRobocallService.findMany,
      ).toHaveBeenCalledWith({
        where: { organizationSlug: 'campaign-org-1', personId: 'person-123' },
        orderBy: expectedOrderBy,
        take: 21,
      })
      // Newest (robocall) first, oldest (door knock) last.
      expect(result.results).toEqual([
        {
          type: ConstituentActivityType.ROBOCALL,
          date: '2026-01-03T10:00:00.000Z',
          data: {
            activityId: 'rc-1',
            answeredAt: null,
            voicemailLeftAt: '2026-01-03T10:05:00.000Z',
            note: null,
            manual: false,
            outreachId: 56,
          },
        },
        {
          type: ConstituentActivityType.TEXT,
          date: '2026-01-02T10:00:00.000Z',
          data: {
            activityId: 'tx-1',
            respondedAt: '2026-01-02T11:00:00.000Z',
            optedOutAt: null,
            note: null,
            manual: false,
            outreachId: 55,
          },
        },
        {
          type: ConstituentActivityType.DOOR_KNOCK,
          date: '2026-01-01T10:00:00.000Z',
          data: {
            activityId: 'dk-1',
            outcome: 'answered',
            supportAnswer: 'supporter',
            note: 'Friendly chat',
            manual: true,
          },
        },
      ])
    })
  })

  describe('getConstituentIssues', () => {
    let issuesService: ContactEngagementService
    let mockPollIndividualMessageService: {
      findMany: ReturnType<typeof vi.fn>
    }

    const personId = 'person-1'
    const electedOfficeId = 'office-1'

    beforeEach(() => {
      mockPollIndividualMessageService = {
        findMany: vi.fn().mockResolvedValue([]),
      }

      issuesService = {
        pollIndividualMessage: mockPollIndividualMessageService,
        getConstituentIssues:
          ContactEngagementService.prototype.getConstituentIssues,
      } as unknown as ContactEngagementService

      issuesService.getConstituentIssues =
        issuesService.getConstituentIssues.bind(issuesService)

      vi.clearAllMocks()
    })

    it('calls pollIndividualMessage service with personId, electedOfficeId, skip, take, and include', async () => {
      mockPollIndividualMessageService.findMany.mockResolvedValue([])

      await issuesService.getConstituentIssues(
        personId,
        electedOfficeId,
        10,
        undefined,
      )

      expect(mockPollIndividualMessageService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            personId,
            electedOfficeId,
            sender: 'CONSTITUENT',
            pollIssues: { some: {} },
          },
          include: {
            pollIssues: true,
            poll: { select: { id: true, name: true } },
          },
          orderBy: { sentAt: 'desc' },
          skip: 0,
          take: 11,
        }),
      )
    })

    it('returns empty results and null nextCursor when no messages', async () => {
      mockPollIndividualMessageService.findMany.mockResolvedValue([])

      const result = await issuesService.getConstituentIssues(
        personId,
        electedOfficeId,
        10,
        undefined,
      )

      expect(result).toEqual({ nextCursor: null, results: [] })
    })

    it('flattens messages with pollIssues into ConstituentIssue results', async () => {
      const sentAt = new Date('2026-02-01T12:00:00Z')
      mockPollIndividualMessageService.findMany.mockResolvedValue([
        {
          sentAt,
          pollIssues: [
            { title: 'Healthcare', summary: 'Cost of care' },
            { title: 'Schools', summary: 'Funding' },
          ],
          poll: { id: 'poll-1', name: 'Community Poll' },
        },
      ])

      const result = await issuesService.getConstituentIssues(
        personId,
        electedOfficeId,
        10,
        undefined,
      )

      expect(result.results).toHaveLength(2)
      expect(result.results[0]).toEqual({
        issueTitle: 'Healthcare',
        issueSummary: 'Cost of care',
        pollTitle: 'Community Poll',
        pollId: 'poll-1',
        date: '2026-02-01T12:00:00.000Z',
      })
      expect(result.results[1]).toEqual({
        issueTitle: 'Schools',
        issueSummary: 'Funding',
        pollTitle: 'Community Poll',
        pollId: 'poll-1',
        date: '2026-02-01T12:00:00.000Z',
      })
      expect(result.nextCursor).toBeNull()
    })

    it('respects take (messages per page) and returns nextCursor when more messages exist', async () => {
      const sentAt = new Date('2026-02-01T12:00:00Z')
      mockPollIndividualMessageService.findMany.mockResolvedValue([
        {
          sentAt,
          pollIssues: [{ title: 'A', summary: 'a' }],
          poll: { id: 'poll-1', name: 'Poll' },
        },
        {
          sentAt,
          pollIssues: [{ title: 'B', summary: 'b' }],
          poll: { id: 'poll-1', name: 'Poll' },
        },
        {
          sentAt,
          pollIssues: [{ title: 'C', summary: 'c' }],
          poll: { id: 'poll-1', name: 'Poll' },
        },
      ])

      const result = await issuesService.getConstituentIssues(
        personId,
        electedOfficeId,
        2,
        undefined,
      )

      expect(result.results).toHaveLength(2)
      expect(result.results[0]?.issueTitle).toBe('A')
      expect(result.results[1]?.issueTitle).toBe('B')
      expect(result.nextCursor).toBe('2')
    })

    it('respects after cursor (skip) and returns next page', async () => {
      const sentAt = new Date('2026-02-01T12:00:00Z')
      mockPollIndividualMessageService.findMany.mockResolvedValue([
        {
          sentAt,
          pollIssues: [{ title: 'C', summary: 'c' }],
          poll: { id: 'poll-1', name: 'Poll' },
        },
      ])

      const result = await issuesService.getConstituentIssues(
        personId,
        electedOfficeId,
        2,
        '2',
      )

      expect(result.results).toHaveLength(1)
      expect(result.results[0]?.issueTitle).toBe('C')
      expect(result.nextCursor).toBeNull()
      expect(mockPollIndividualMessageService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 2, take: 3 }),
      )
    })

    it('treats invalid after as 0', async () => {
      const sentAt = new Date('2026-02-01T12:00:00Z')
      mockPollIndividualMessageService.findMany.mockResolvedValue([
        {
          sentAt,
          pollIssues: [{ title: 'Only', summary: 'one' }],
          poll: { id: 'poll-1', name: 'Poll' },
        },
      ])

      const result = await issuesService.getConstituentIssues(
        personId,
        electedOfficeId,
        10,
        'not-a-number',
      )

      expect(result.results).toHaveLength(1)
      expect(result.results[0]?.issueTitle).toBe('Only')
      expect(result.nextCursor).toBeNull()
    })
  })
})

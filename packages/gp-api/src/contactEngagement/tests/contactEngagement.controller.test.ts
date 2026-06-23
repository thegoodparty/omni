import { Campaign, ElectedOffice } from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactEngagementController } from '../contactEngagement.controller'
import { ContactEngagementService } from '../contactEngagement.service'
import {
  ConstituentActivityEventType,
  ConstituentActivityType,
} from '../contactEngagement.types'

describe('ContactEngagementController', () => {
  let controller: ContactEngagementController
  let contactEngagementService: ContactEngagementService

  const mockElectedOffice: ElectedOffice = {
    id: 'office-1',
    userId: 1,
    campaignId: 1,
    organizationSlug: 'eo-office-1',
    swornInDate: null,
    electedDate: null,
    termStartDate: null,
    termEndDate: null,
    party: null,
    pledgedAt: null,
    onboardingCompletedAt: null,
    selfReported: false,
    onboardingStep: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const noElectedOffice = undefined
  const noCampaign = undefined as unknown as Campaign
  const mockCampaign = { id: 99 } as unknown as Campaign

  beforeEach(() => {
    contactEngagementService = {
      getIndividualActivities: vi.fn(),
      getCampaignActivities: vi.fn(),
      getConstituentIssues: vi.fn(),
    } as unknown as ContactEngagementService

    controller = new ContactEngagementController(contactEngagementService)
    vi.clearAllMocks()
  })

  describe('getIndividualActivities', () => {
    const mockParams = {
      id: 'person-123',
    }
    const mockQuery = {
      type: ConstituentActivityType.POLL_INTERACTIONS,
      take: 20,
    }

    it('returns individual activities with the provided elected office', async () => {
      const mockServiceResponse = {
        nextCursor: 'last-seen-id',
        results: [
          {
            type: ConstituentActivityType.POLL_INTERACTIONS,
            date: 'myDate',
            data: {
              pollId: 'poll-id',
              pollTitle: 'poll-title',
              events: [
                {
                  type: ConstituentActivityEventType.SENT,
                  date: 'myDate',
                },
              ],
            },
          },
        ],
      }

      vi.spyOn(
        contactEngagementService,
        'getIndividualActivities',
      ).mockResolvedValue(mockServiceResponse)

      const result = await controller.getIndividualActivities(
        mockParams,
        mockQuery,
        mockElectedOffice,
        noCampaign,
      )

      expect(
        contactEngagementService.getIndividualActivities,
      ).toHaveBeenCalledWith({
        personId: 'person-123',
        type: ConstituentActivityType.POLL_INTERACTIONS,
        take: 20,
        electedOfficeId: 'office-1',
      })

      expect(result).toEqual(mockServiceResponse)
    })

    it('uses the elected office id from the decorator', async () => {
      const differentElectedOffice: ElectedOffice = {
        id: 'office-42',
        userId: 42,
        campaignId: 1,
        organizationSlug: 'eo-office-1',
        swornInDate: null,
        electedDate: null,
        termStartDate: null,
        termEndDate: null,
        party: null,
        pledgedAt: null,
        onboardingCompletedAt: null,
        selfReported: false,
        onboardingStep: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      vi.spyOn(
        contactEngagementService,
        'getIndividualActivities',
      ).mockResolvedValue({ nextCursor: null, results: [] })

      await controller.getIndividualActivities(
        mockParams,
        mockQuery,
        differentElectedOffice,
        noCampaign,
      )

      expect(
        contactEngagementService.getIndividualActivities,
      ).toHaveBeenCalledWith({
        personId: 'person-123',
        type: ConstituentActivityType.POLL_INTERACTIONS,
        take: 20,
        electedOfficeId: 'office-42',
      })
    })

    it('uses the campaign branch when no elected office is present', async () => {
      const campaignResponse = { nextCursor: null, results: [] }
      vi.spyOn(
        contactEngagementService,
        'getCampaignActivities',
      ).mockResolvedValue(campaignResponse)

      const result = await controller.getIndividualActivities(
        { id: 'LAL-1' },
        { take: 5, after: '10' },
        noElectedOffice,
        mockCampaign,
      )

      expect(
        contactEngagementService.getCampaignActivities,
      ).toHaveBeenCalledWith({
        lalVoterId: 'LAL-1',
        campaignId: 99,
        take: 5,
        after: '10',
      })
      expect(
        contactEngagementService.getIndividualActivities,
      ).not.toHaveBeenCalled()
      expect(result).toEqual(campaignResponse)
    })
  })

  describe('getConstituentIssues', () => {
    it('delegates to the service for an elected office', async () => {
      const issuesResponse = { nextCursor: null, results: [] }
      vi.spyOn(
        contactEngagementService,
        'getConstituentIssues',
      ).mockResolvedValue(issuesResponse)

      const result = await controller.getConstituentIssues(
        { id: 'person-123' },
        { take: 3, after: '2' },
        mockElectedOffice,
      )

      expect(
        contactEngagementService.getConstituentIssues,
      ).toHaveBeenCalledWith('person-123', 'office-1', 3, '2')
      expect(result).toEqual(issuesResponse)
    })

    it('returns empty issues for a campaign context without calling the service', async () => {
      const result = await controller.getConstituentIssues(
        { id: 'LAL-1' },
        { take: 3 },
        noElectedOffice,
      )

      expect(result).toEqual({ nextCursor: null, results: [] })
      expect(
        contactEngagementService.getConstituentIssues,
      ).not.toHaveBeenCalled()
    })
  })
})

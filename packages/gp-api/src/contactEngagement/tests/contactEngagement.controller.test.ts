import { Campaign, ElectedOffice } from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactEngagementController } from '../contactEngagement.controller'
import { ContactEngagementService } from '../contactEngagement.service'
import {
  ConstituentActivityEventType,
  ConstituentActivityType,
  GetIndividualActivitiesResponse,
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
  const mockCampaign = {
    id: 99,
    organizationSlug: 'campaign-org-99',
  } as unknown as Campaign

  beforeEach(() => {
    contactEngagementService = {
      getIndividualActivities: vi.fn(),
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
      take: 20,
    }

    it('resolves organizationSlug + electedOfficeId from the elected office', async () => {
      const mockServiceResponse: GetIndividualActivitiesResponse = {
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
        organizationSlug: 'eo-office-1',
        electedOfficeId: 'office-1',
        take: 20,
      })

      expect(result).toEqual(mockServiceResponse)
    })

    it('uses the elected office id and organizationSlug from the decorator', async () => {
      const differentElectedOffice: ElectedOffice = {
        id: 'office-42',
        userId: 42,
        campaignId: 1,
        organizationSlug: 'eo-office-42',
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
        organizationSlug: 'eo-office-42',
        electedOfficeId: 'office-42',
        take: 20,
      })
    })

    it('resolves organizationSlug + campaignId from the campaign when no elected office is present', async () => {
      const campaignResponse = { nextCursor: null, results: [] }
      vi.spyOn(
        contactEngagementService,
        'getIndividualActivities',
      ).mockResolvedValue(campaignResponse)

      const result = await controller.getIndividualActivities(
        { id: 'person-456' },
        { take: 5, after: '10' },
        noElectedOffice,
        mockCampaign,
      )

      expect(
        contactEngagementService.getIndividualActivities,
      ).toHaveBeenCalledWith({
        personId: 'person-456',
        organizationSlug: 'campaign-org-99',
        campaignId: 99,
        take: 5,
        after: '10',
      })
      expect(result).toEqual(campaignResponse)
    })

    it('forwards the lalVoterId query param for the campaign branch', async () => {
      vi.spyOn(
        contactEngagementService,
        'getIndividualActivities',
      ).mockResolvedValue({ nextCursor: null, results: [] })

      await controller.getIndividualActivities(
        { id: 'person-456' },
        { take: 5, lalVoterId: 'LAL-1' },
        noElectedOffice,
        mockCampaign,
      )

      expect(
        contactEngagementService.getIndividualActivities,
      ).toHaveBeenCalledWith({
        personId: 'person-456',
        organizationSlug: 'campaign-org-99',
        campaignId: 99,
        take: 5,
        lalVoterId: 'LAL-1',
      })
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

import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { FastifyReply } from 'fastify'
import { Campaign } from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutreachP2pSmsCaptureService } from '@/outreach/services/outreachP2pSmsCapture.service'
import { P2pController } from './p2p.controller'
import { PhoneListState } from './peerly.types'
import { P2pPhoneListUploadService } from './services/p2pPhoneListUpload.service'
import { PeerlyPhoneListCaptureService } from './services/peerlyPhoneListCapture.service'
import { PeerlyPhoneListService } from './services/peerlyPhoneList.service'

const mockCampaign: Campaign = {
  id: 1,
  userId: 1,
  slug: 'test-campaign',
  organizationSlug: 'campaign-1',
  isActive: true,
  isPro: false,
  isDemo: false,
  isVerified: false,
  didWin: null,
  primaryResult: null,
  ballotStatus: null,
  signupGoal: null,
  dateVerified: null,
  tier: null,
  formattedAddress: null,
  placeId: null,
  campaignEmail: null,
  aiContent: {},
  vendorTsData: {},
  canDownloadFederal: false,
  completedTaskIds: [],
  hasFreeTextsOffer: false,
  freeTextsOfferRedeemedAt: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  data: {},
  details: { state: 'CA', electionDate: '2026-11-03' },
}

function createMockReply(): FastifyReply {
  return { status: vi.fn().mockReturnThis() } as unknown as FastifyReply
}

describe('P2pController', () => {
  let controller: P2pController
  let mockPeerlyPhoneListService: {
    checkPhoneListStatus: ReturnType<typeof vi.fn>
    getPhoneListDetails: ReturnType<typeof vi.fn>
  }
  let mockP2pPhoneListUploadService: {
    uploadPhoneList: ReturnType<typeof vi.fn>
  }
  let mockPeerlyPhoneListCapture: {
    stampPeerlyListId: ReturnType<typeof vi.fn>
    findFirst: ReturnType<typeof vi.fn>
    isLeadsLoadedStable: ReturnType<typeof vi.fn>
  }
  let mockP2pSmsCapture: {
    captureHoldsForReadyList: ReturnType<typeof vi.fn>
    finalizeDraftsForReadyList: ReturnType<typeof vi.fn>
  }
  let mockRes: FastifyReply

  beforeEach(() => {
    mockPeerlyPhoneListService = {
      checkPhoneListStatus: vi.fn(),
      getPhoneListDetails: vi.fn(),
    }
    mockP2pPhoneListUploadService = {
      uploadPhoneList: vi.fn(),
    }
    mockPeerlyPhoneListCapture = {
      stampPeerlyListId: vi.fn().mockResolvedValue(undefined),
      findFirst: vi.fn().mockResolvedValue({
        id: 1,
        excludedOptedOutCount: 0,
        excludedDuplicatePhoneCount: 0,
      }),
      // Defaulted true (stable/fully-loaded) so every pre-existing test below
      // reaches the same `ready` behavior it asserted before this guard
      // existed; the guard's own behavior is covered by the integration
      // tests against the real service in p2pPhoneListUpload.routes.test.ts.
      isLeadsLoadedStable: vi.fn().mockResolvedValue(true),
    }
    mockP2pSmsCapture = {
      captureHoldsForReadyList: vi.fn().mockResolvedValue(undefined),
      finalizeDraftsForReadyList: vi.fn().mockResolvedValue(undefined),
    }
    mockRes = createMockReply()
    controller = new P2pController(
      mockPeerlyPhoneListService as unknown as PeerlyPhoneListService,
      mockPeerlyPhoneListCapture as unknown as PeerlyPhoneListCaptureService,
      mockP2pPhoneListUploadService as unknown as P2pPhoneListUploadService,
      mockP2pSmsCapture as unknown as OutreachP2pSmsCaptureService,
      createMockLogger(),
    )
  })

  describe('checkPhoneListStatus', () => {
    it('returns 202 with message when service returns null (transient error)', async () => {
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValue(null)

      const result = await controller.checkPhoneListStatus(
        mockCampaign,
        'test-token',
        mockRes,
      )

      expect(mockRes.status).toHaveBeenCalledWith(202)
      expect(result).toEqual({
        message: 'Phone list status is not yet available. Please try again.',
      })
    })

    it('returns 202 with message when list_state is PROCESSING', async () => {
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValue({
        Data: { list_state: PhoneListState.PROCESSING },
      })

      const result = await controller.checkPhoneListStatus(
        mockCampaign,
        'test-token',
        mockRes,
      )

      expect(mockRes.status).toHaveBeenCalledWith(202)
      expect(result).toEqual({
        message:
          'Phone list is still processing. Please try again in a few moments.',
      })
    })

    it('returns 202 with message when list_state is PENDING', async () => {
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValue({
        Data: { list_state: PhoneListState.PENDING },
      })

      const result = await controller.checkPhoneListStatus(
        mockCampaign,
        'test-token',
        mockRes,
      )

      expect(mockRes.status).toHaveBeenCalledWith(202)
      expect(result).toEqual({
        message: 'Phone list is not ready. Current status: PENDING',
      })
    })

    it('returns 202 with unknown status when list_state is missing', async () => {
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValue({
        Data: {},
      })

      const result = await controller.checkPhoneListStatus(
        mockCampaign,
        'test-token',
        mockRes,
      )

      expect(mockRes.status).toHaveBeenCalledWith(202)
      expect(result).toEqual({
        message: 'Phone list is not ready. Current status: unknown',
      })
    })

    it('throws BadGatewayException when list_state is ACTIVE but list_id is missing', async () => {
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValue({
        Data: { list_state: PhoneListState.ACTIVE },
      })

      await expect(
        controller.checkPhoneListStatus(mockCampaign, 'test-token', mockRes),
      ).rejects.toThrow(BadGatewayException)
      await expect(
        controller.checkPhoneListStatus(mockCampaign, 'test-token', mockRes),
      ).rejects.toMatchObject({
        message: 'Phone list is active but no list_id was returned',
      })
    })

    it('wraps unexpected errors in BadGatewayException', async () => {
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockRejectedValue(new Error('Unexpected failure'))

      await expect(
        controller.checkPhoneListStatus(mockCampaign, 'test-token', mockRes),
      ).rejects.toThrow(BadGatewayException)
      await expect(
        controller.checkPhoneListStatus(mockCampaign, 'test-token', mockRes),
      ).rejects.toMatchObject({
        message: 'Failed to check phone list status.',
      })
    })

    it('returns phoneListId and leadsLoaded when list is ACTIVE with list_id', async () => {
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValue({
        Data: { list_state: PhoneListState.ACTIVE, list_id: 123 },
      })
      vi.mocked(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).mockResolvedValue({
        leads_loaded: 500,
        leads_duplicate: 10,
        leads_master_dnc: 5,
        leads_cell_dnc: 2,
        leads_malformed: 3,
        use_nat_dnc: 1,
        suppress_cell_phones: 1,
        account_id: 'acc-123',
        leads_acct_dnc: 0,
        list_name: 'Test List',
        list_state: PhoneListState.ACTIVE,
        list_id: 123,
        leads_cell_suppressed: 0,
        leads_supplied: 520,
        leads_invalid: 0,
        leads_nat_dnc: 0,
        upload_by: 'user',
        shared: 0,
        upload_date: '2025-01-01',
      })

      const result = await controller.checkPhoneListStatus(
        mockCampaign,
        'test-token',
        mockRes,
      )

      expect(result).toEqual({
        phoneListId: 123,
        leadsLoaded: 500,
        excludedOptedOutCount: 0,
        excludedDuplicatePhoneCount: 0,
      })
      expect(mockRes.status).not.toHaveBeenCalled()
      expect(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).toHaveBeenCalledWith(123)
      expect(mockPeerlyPhoneListCapture.stampPeerlyListId).toHaveBeenCalledWith(
        'test-token',
        123,
        500,
      )
      // Edge (b): the browser poll that first stamps ready also finalizes any
      // pre-build paid draft (deferred at the webhook) and fires the capture, so
      // neither is left to the backstop.
      expect(mockP2pSmsCapture.finalizeDraftsForReadyList).toHaveBeenCalledWith(
        123,
      )
      expect(mockP2pSmsCapture.captureHoldsForReadyList).toHaveBeenCalledWith(
        123,
      )
    })

    it('returns 202 (still loading) when leads_loaded has not stabilized, without stamping', async () => {
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValue({
        Data: { list_state: PhoneListState.ACTIVE, list_id: 123 },
      })
      vi.mocked(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).mockResolvedValue({ leads_loaded: 500, leads_supplied: 10_000 })
      vi.mocked(
        mockPeerlyPhoneListCapture.isLeadsLoadedStable,
      ).mockResolvedValue(false)

      const result = await controller.checkPhoneListStatus(
        mockCampaign,
        'test-token',
        mockRes,
      )

      expect(mockRes.status).toHaveBeenCalledWith(202)
      expect(result).toEqual({
        message:
          'Phone list is still loading leads. Please try again in a few moments.',
      })
      expect(
        mockPeerlyPhoneListCapture.isLeadsLoadedStable,
      ).toHaveBeenCalledWith({
        buildId: 1,
        leadsLoaded: 500,
        leadsSupplied: 10_000,
      })
      expect(
        mockPeerlyPhoneListCapture.stampPeerlyListId,
      ).not.toHaveBeenCalled()
    })

    it('a repeat poll on an already-ready row skips the stability gate entirely', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValue({
        id: 1,
        peerlyListId: 123,
        excludedOptedOutCount: 0,
        excludedDuplicatePhoneCount: 0,
      })
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValue({
        Data: { list_state: PhoneListState.ACTIVE, list_id: 123 },
      })
      vi.mocked(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).mockResolvedValue({ leads_loaded: 300, leads_supplied: 10_000 })

      const result = await controller.checkPhoneListStatus(
        mockCampaign,
        'test-token',
        mockRes,
      )

      // leads_loaded (300) never equals leads_supplied (10,000) here — if the
      // gate ran, this would be a 202. It must not run once the row is
      // already stamped ready.
      expect(
        mockPeerlyPhoneListCapture.isLeadsLoadedStable,
      ).not.toHaveBeenCalled()
      // Already ready before this poll: the finalize + capture edges fired on
      // the original transition, so a repeat poll must not re-fire them.
      expect(
        mockP2pSmsCapture.finalizeDraftsForReadyList,
      ).not.toHaveBeenCalled()
      expect(mockP2pSmsCapture.captureHoldsForReadyList).not.toHaveBeenCalled()
      expect(mockRes.status).not.toHaveBeenCalled()
      expect(result).toEqual({
        phoneListId: 123,
        leadsLoaded: 300,
        excludedOptedOutCount: 0,
        excludedDuplicatePhoneCount: 0,
      })
    })

    it('still returns the ready status when the stamp write fails', async () => {
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValue({
        Data: { list_state: PhoneListState.ACTIVE, list_id: 123 },
      })
      vi.mocked(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).mockResolvedValue({
        leads_loaded: 500,
      })
      vi.mocked(mockPeerlyPhoneListCapture.stampPeerlyListId).mockRejectedValue(
        new Error('db hiccup'),
      )

      const result = await controller.checkPhoneListStatus(
        mockCampaign,
        'test-token',
        mockRes,
      )

      expect(result).toEqual({
        phoneListId: 123,
        leadsLoaded: 500,
        excludedOptedOutCount: 0,
        excludedDuplicatePhoneCount: 0,
      })
    })

    // ENG-10808: distinct, non-zero, and unequal-to-each-other values so a
    // swapped-field or dropped-field regression fails immediately.
    it('surfaces the capture row exclusion counts alongside phoneListId and leadsLoaded', async () => {
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValue({
        Data: { list_state: PhoneListState.ACTIVE, list_id: 123 },
      })
      vi.mocked(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).mockResolvedValue({
        leads_loaded: 500,
      })
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValue({
        id: 1,
        excludedOptedOutCount: 12,
        excludedDuplicatePhoneCount: 7,
      })

      const result = await controller.checkPhoneListStatus(
        mockCampaign,
        'test-token',
        mockRes,
      )

      expect(result).toEqual({
        phoneListId: 123,
        leadsLoaded: 500,
        excludedOptedOutCount: 12,
        excludedDuplicatePhoneCount: 7,
      })
    })

    it('404s a token the campaign does not own, before touching Peerly', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValue(null)

      await expect(
        controller.checkPhoneListStatus(mockCampaign, 'foreign-token', mockRes),
      ).rejects.toThrow(NotFoundException)

      expect(mockPeerlyPhoneListCapture.findFirst).toHaveBeenCalledWith({
        where: { token: 'foreign-token', campaignId: mockCampaign.id },
      })
      expect(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).not.toHaveBeenCalled()
      expect(
        mockPeerlyPhoneListCapture.stampPeerlyListId,
      ).not.toHaveBeenCalled()
    })
  })

  describe('uploadPhoneList', () => {
    it('returns both token and buildId on successful upload', async () => {
      vi.mocked(
        mockP2pPhoneListUploadService.uploadPhoneList,
      ).mockResolvedValue({
        token: 'upload-token-123',
        listName: 'My List',
        buildId: 'build-row-1',
      })

      const result = await controller.uploadPhoneList(mockCampaign, {
        name: 'My List',
      })

      expect(result).toEqual({
        token: 'upload-token-123',
        buildId: 'build-row-1',
      })
    })

    it('throws BadGatewayException when upload fails', async () => {
      vi.mocked(
        mockP2pPhoneListUploadService.uploadPhoneList,
      ).mockRejectedValue(new Error('Upload failed'))

      await expect(
        controller.uploadPhoneList(mockCampaign, { name: 'My List' }),
      ).rejects.toThrow(BadGatewayException)
      await expect(
        controller.uploadPhoneList(mockCampaign, { name: 'My List' }),
      ).rejects.toMatchObject({
        message: 'Failed to upload phone list.',
      })
    })

    it('preserves HttpException from the service (e.g. MISSING_L2_DISTRICT_DATA)', async () => {
      const structured = new ConflictException({
        statusCode: 409,
        message: 'Voter data is not available for your selected office.',
        errorCode: 'MISSING_L2_DISTRICT_DATA',
      })
      vi.mocked(
        mockP2pPhoneListUploadService.uploadPhoneList,
      ).mockRejectedValue(structured)

      await expect(
        controller.uploadPhoneList(mockCampaign, { name: 'My List' }),
      ).rejects.toBe(structured)
    })
  })

  describe('checkPhoneListBuildStatus', () => {
    it('returns 202 when the build has no token yet (queued/building)', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValue({
        id: 'build-1',
        buildStatus: 'queued',
        buildError: null,
        token: null,
        excludedOptedOutCount: 0,
        excludedDuplicatePhoneCount: 0,
      })

      const result = await controller.checkPhoneListBuildStatus(
        mockCampaign,
        'build-1',
        mockRes,
      )

      expect(mockRes.status).toHaveBeenCalledWith(202)
      expect(result).toEqual({
        message: 'Phone list build is still in progress. Please try again.',
      })
      expect(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).not.toHaveBeenCalled()
    })

    it('returns 202 when a token exists but Peerly has not resolved the list yet', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValue({
        id: 'build-1',
        buildStatus: 'processing',
        buildError: null,
        token: 'peerly-token',
        excludedOptedOutCount: 0,
        excludedDuplicatePhoneCount: 0,
      })
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValue({
        Data: { list_state: PhoneListState.PROCESSING },
      })

      const result = await controller.checkPhoneListBuildStatus(
        mockCampaign,
        'build-1',
        mockRes,
      )

      expect(mockRes.status).toHaveBeenCalledWith(202)
      expect(result).toEqual({
        message:
          'Phone list is still processing. Please try again in a few moments.',
      })
    })

    it('returns 200 ready with phoneListId/leadsLoaded and stamps peerlyListId', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValue({
        id: 'build-1',
        buildStatus: 'processing',
        buildError: null,
        token: 'peerly-token',
        excludedOptedOutCount: 12,
        excludedDuplicatePhoneCount: 7,
      })
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValue({
        Data: { list_state: PhoneListState.ACTIVE, list_id: 123 },
      })
      vi.mocked(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).mockResolvedValue({ leads_loaded: 500 })

      const result = await controller.checkPhoneListBuildStatus(
        mockCampaign,
        'build-1',
        mockRes,
      )

      expect(result).toEqual({
        phoneListId: 123,
        leadsLoaded: 500,
        excludedOptedOutCount: 12,
        excludedDuplicatePhoneCount: 7,
      })
      expect(mockRes.status).not.toHaveBeenCalled()
      expect(mockPeerlyPhoneListCapture.stampPeerlyListId).toHaveBeenCalledWith(
        'peerly-token',
        123,
        500,
      )
    })

    it('returns 200 failed with the stored buildError, without calling Peerly', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValue({
        id: 'build-1',
        buildStatus: 'failed',
        buildError: 'No contacts matched the filter',
        token: null,
        excludedOptedOutCount: 0,
        excludedDuplicatePhoneCount: 0,
      })

      const result = await controller.checkPhoneListBuildStatus(
        mockCampaign,
        'build-1',
        mockRes,
      )

      expect(result).toEqual({
        buildStatus: 'failed',
        buildError: 'No contacts matched the filter',
      })
      expect(mockRes.status).not.toHaveBeenCalled()
      expect(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).not.toHaveBeenCalled()
    })

    it('404s a build the campaign does not own, before touching Peerly', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValue(null)

      await expect(
        controller.checkPhoneListBuildStatus(
          mockCampaign,
          'foreign-build',
          mockRes,
        ),
      ).rejects.toThrow(NotFoundException)

      expect(mockPeerlyPhoneListCapture.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-build', campaignId: mockCampaign.id },
      })
      expect(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).not.toHaveBeenCalled()
    })
  })
})

import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { FREE_TEXTS_OFFER } from '@/shared/constants/freeTextsOffer'
import { PRICE_PER_TEXT_TENTH_CENTS } from '@goodparty_org/contracts'
import {
  calcTextAmountInCents,
  maxTextsForAmountInCents,
} from '@/shared/util/textPricing.util'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { ContactsService } from 'src/contacts/services/contacts.service'
import { MAX_AUDIENCE_RECIPIENTS } from 'src/contacts/utils/audienceResolution.util'
import { OrganizationsService } from 'src/organizations/services/organizations.service'
import { VoterFileFilterService } from 'src/voters/services/voterFileFilter.service'
import { PeerlyPhoneList } from 'src/generated/prisma'
import { PhoneListState } from 'src/vendors/peerly/peerly.types'
import { PeerlyPhoneListCaptureService } from 'src/vendors/peerly/services/peerlyPhoneListCapture.service'
import { PeerlyPhoneListService } from 'src/vendors/peerly/services/peerlyPhoneList.service'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { OutreachPurchaseMetadata } from '../types/outreach.types'
import { OutreachService } from './outreach.service'
import { OutreachP2pSmsHoldService } from './outreachP2pSmsHold.service'
import { OutreachP2pSmsCaptureService } from './outreachP2pSmsCapture.service'
import { OutreachPurchaseHandlerService } from './outreachPurchase.service'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCampaignsService = {
  checkFreeTextsEligibility: vi.fn(),
  redeemFreeTexts: vi.fn(),
} as unknown as CampaignsService

const mockOutreachService = {
  finalizeOutreachPurchase: vi.fn(),
  failOutreachPurchase: vi.fn(),
  recordCheckoutSession: vi.fn(),
  recordFreePurchase: vi.fn(),
  markFreeTextsConsumed: vi.fn(),
} as unknown as OutreachService

const mockPeerlyPhoneListService = {
  checkPhoneListStatus: vi.fn(),
  getPhoneListDetails: vi.fn(),
} as unknown as PeerlyPhoneListService

const mockPeerlyPhoneListCapture = {
  findFirst: vi.fn(),
  countRecipients: vi.fn(),
  persistSendCap: vi.fn(),
} as unknown as PeerlyPhoneListCaptureService

const mockContactsService = {
  findContactsForFilter: vi.fn(),
} as unknown as ContactsService

const mockOrganizationsService = {
  findFirst: vi.fn(),
} as unknown as OrganizationsService

const mockVoterFileFilterService = {
  findByIdAndOrganizationSlug: vi.fn(),
} as unknown as VoterFileFilterService

const mockP2pSmsHold = {
  recordHold: vi.fn(),
} as unknown as OutreachP2pSmsHoldService

const mockP2pSmsCapture = {
  captureHold: vi.fn(),
} as unknown as OutreachP2pSmsCaptureService

const mockLogger = createMockLogger()

const service = new OutreachPurchaseHandlerService(
  mockCampaignsService,
  mockOutreachService,
  mockPeerlyPhoneListService,
  mockPeerlyPhoneListCapture,
  mockContactsService,
  mockOrganizationsService,
  mockVoterFileFilterService,
  mockP2pSmsHold,
  mockP2pSmsCapture,
  mockLogger,
)

const baseMetadata: OutreachPurchaseMetadata = {
  contactCount: 500,
  outreachType: 'p2p',
  audienceSize: 1000,
  phoneListToken: 'token-abc',
}

const CAPTURED_LIST_FIXTURE: PeerlyPhoneList = {
  id: 'list-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  organizationSlug: 'org-1',
  campaignId: 1,
  token: 'token-abc',
  peerlyListId: 42,
  voterFileFilterId: null,
  buildStatus: 'ready',
  buildError: null,
  requestSnapshot: null,
  lastSeenLeadsLoaded: null,
  leadsLoaded: null,
  buildAttempts: 0,
  excludedOptedOutCount: 0,
  excludedDuplicatePhoneCount: 0,
  sendCapTexts: null,
}

const PHONE_LIST_DETAILS_FIXTURE = {
  leads_duplicate: 0,
  leads_master_dnc: 0,
  leads_cell_dnc: 0,
  leads_malformed: 0,
  leads_loaded: 0,
  use_nat_dnc: 0,
  suppress_cell_phones: 0,
  account_id: 'acct-1',
  leads_acct_dnc: 0,
  list_name: 'test-list',
  list_state: PhoneListState.ACTIVE,
  list_id: 42,
  leads_cell_suppressed: 0,
  leads_supplied: 0,
  leads_invalid: 0,
  leads_nat_dnc: 0,
  upload_by: 'system',
  shared: 0,
  upload_date: '2026-01-01',
}

// Sets up the "happy path" Peerly fetch: a captured list exists for the
// token, and Peerly reports leadsLoaded for it.
const mockServerLeadsLoaded = (leadsLoaded: number) => {
  vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce(
    CAPTURED_LIST_FIXTURE,
  )
  vi.mocked(
    mockPeerlyPhoneListService.checkPhoneListStatus,
  ).mockResolvedValueOnce({
    Data: { list_id: 42, list_state: PhoneListState.ACTIVE },
  })
  vi.mocked(
    mockPeerlyPhoneListService.getPhoneListDetails,
  ).mockResolvedValueOnce({
    ...PHONE_LIST_DETAILS_FIXTURE,
    leads_loaded: leadsLoaded,
  })
}

// Sets up the fallback path: a captured list exists, but the Peerly status
// fetch fails, so the captured recipient count is used instead.
const mockServerFallbackCount = (count: number) => {
  vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce(
    CAPTURED_LIST_FIXTURE,
  )
  vi.mocked(
    mockPeerlyPhoneListService.checkPhoneListStatus,
  ).mockRejectedValueOnce(new Error('Peerly unreachable'))
  vi.mocked(mockPeerlyPhoneListCapture.countRecipients).mockResolvedValueOnce(
    count,
  )
}

// Mirrors what PeerlyErrorHandlingService.handleApiError actually throws: a
// BadGatewayException wrapping the original axios error as `cause`.
const buildPeerlyHttpError = (status: number) =>
  new BadGatewayException('Peerly API error', {
    cause: { isAxiosError: true, response: { status } },
  })

describe('calcTextAmountInCents', () => {
  it('returns 4 cents for 1 text', () => {
    expect(calcTextAmountInCents(1)).toBe(4)
  })

  it('returns 0 for 0 texts', () => {
    expect(calcTextAmountInCents(0)).toBe(0)
  })

  it('returns 1750 cents for 500 texts', () => {
    expect(calcTextAmountInCents(500)).toBe(1750)
  })

  it('uses integer arithmetic consistently', () => {
    expect(calcTextAmountInCents(3)).toBe(
      Math.floor((3 * PRICE_PER_TEXT_TENTH_CENTS + 5) / 10),
    )
  })
})

describe('OutreachPurchaseHandlerService', () => {
  describe('validatePurchase', () => {
    it('throws when contactCount is missing', async () => {
      await expect(
        service.validatePurchase({
          ...baseMetadata,
          contactCount: 0,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('passes with valid contactCount', async () => {
      await expect(
        service.validatePurchase(baseMetadata),
      ).resolves.toBeUndefined()
    })

    it('ignores pricePerContact from client', async () => {
      await expect(
        service.validatePurchase({
          ...baseMetadata,
          pricePerContact: 0,
        }),
      ).resolves.toBeUndefined()
    })
  })

  describe('calculateAmount', () => {
    it('uses server-side pricing, not client pricePerContact', async () => {
      mockServerLeadsLoaded(500)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        campaignId: 1,
        pricePerContact: 0,
      })

      expect(amount).toBe(calcTextAmountInCents(500))
      expect(amount).toBeGreaterThan(0)
    })

    it('skips discount check when outreachType is not p2p', async () => {
      const amount = await service.calculateAmount({
        ...baseMetadata,
        campaignId: 1,
        outreachType: 'text',
      })

      expect(amount).toBe(calcTextAmountInCents(500))
      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
      expect(mockPeerlyPhoneListCapture.findFirst).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when campaignId is missing for a p2p purchase, without looking up the token', async () => {
      await expect(
        service.calculateAmount({
          ...baseMetadata,
          campaignId: undefined,
        }),
      ).rejects.toThrow(BadRequestException)

      expect(mockPeerlyPhoneListCapture.findFirst).not.toHaveBeenCalled()
      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
    })

    it('applies free texts discount for eligible p2p campaign', async () => {
      const contactCount = 7000
      mockServerLeadsLoaded(contactCount)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        contactCount,
        campaignId: 1,
      })

      const billable = contactCount - FREE_TEXTS_OFFER.COUNT
      expect(amount).toBe(calcTextAmountInCents(billable))
    })

    it('returns 0 when contactCount equals FREE_TEXTS_OFFER.COUNT exactly', async () => {
      mockServerLeadsLoaded(FREE_TEXTS_OFFER.COUNT)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        contactCount: FREE_TEXTS_OFFER.COUNT,
        campaignId: 1,
      })

      expect(amount).toBe(0)
    })

    it('returns 0 when contactCount is below FREE_TEXTS_OFFER.COUNT', async () => {
      mockServerLeadsLoaded(100)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        contactCount: 100,
        campaignId: 1,
      })

      expect(amount).toBe(0)
    })

    it('charges full price when campaign has no offer', async () => {
      mockServerLeadsLoaded(500)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        contactCount: 500,
        campaignId: 1,
      })

      expect(amount).toBe(calcTextAmountInCents(500))
    })

    it('bills the Peerly-derived leads_loaded, not the client contactCount, and logs the mismatch', async () => {
      mockServerLeadsLoaded(80)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        contactCount: 100,
        campaignId: 1,
      })

      expect(amount).toBe(calcTextAmountInCents(80))
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          clientContactCount: 100,
          serverContactCount: 80,
        }),
        expect.stringContaining('mismatch'),
      )
    })

    it('falls back to the captured recipient count when checkPhoneListStatus throws', async () => {
      mockServerFallbackCount(80)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        contactCount: 80,
        campaignId: 1,
      })

      expect(amount).toBe(calcTextAmountInCents(80))
      expect(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).not.toHaveBeenCalled()
      expect(mockPeerlyPhoneListCapture.countRecipients).toHaveBeenCalledWith(
        CAPTURED_LIST_FIXTURE.id,
      )
    })

    it('falls back to the captured recipient count when getPhoneListDetails throws', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce(
        CAPTURED_LIST_FIXTURE,
      )
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValueOnce({
        Data: { list_id: 42, list_state: PhoneListState.ACTIVE },
      })
      vi.mocked(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).mockRejectedValueOnce(new Error('Peerly details fetch failed'))
      vi.mocked(
        mockPeerlyPhoneListCapture.countRecipients,
      ).mockResolvedValueOnce(80)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        contactCount: 80,
        campaignId: 1,
      })

      expect(amount).toBe(calcTextAmountInCents(80))
      expect(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).toHaveBeenCalledWith(42)
      expect(mockPeerlyPhoneListCapture.countRecipients).toHaveBeenCalledWith(
        CAPTURED_LIST_FIXTURE.id,
      )
    })

    it('throws BadRequestException, without falling back, when Peerly returns a 4xx', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce(
        CAPTURED_LIST_FIXTURE,
      )
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockRejectedValueOnce(buildPeerlyHttpError(400))

      await expect(
        service.calculateAmount({
          ...baseMetadata,
          campaignId: 1,
        }),
      ).rejects.toThrow(BadRequestException)

      expect(mockPeerlyPhoneListCapture.countRecipients).not.toHaveBeenCalled()
      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
    })

    it('throws BadRequestException, without falling back, when getPhoneListDetails returns a 4xx', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce(
        CAPTURED_LIST_FIXTURE,
      )
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValueOnce({
        Data: { list_id: 42, list_state: PhoneListState.ACTIVE },
      })
      vi.mocked(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).mockRejectedValueOnce(buildPeerlyHttpError(400))

      await expect(
        service.calculateAmount({
          ...baseMetadata,
          campaignId: 1,
        }),
      ).rejects.toThrow(BadRequestException)

      expect(mockPeerlyPhoneListCapture.countRecipients).not.toHaveBeenCalled()
      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
    })

    it('falls back to the captured recipient count when Peerly returns a 5xx', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce(
        CAPTURED_LIST_FIXTURE,
      )
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockRejectedValueOnce(buildPeerlyHttpError(500))
      vi.mocked(
        mockPeerlyPhoneListCapture.countRecipients,
      ).mockResolvedValueOnce(80)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        contactCount: 80,
        campaignId: 1,
      })

      expect(amount).toBe(calcTextAmountInCents(80))
      expect(mockPeerlyPhoneListCapture.countRecipients).toHaveBeenCalledWith(
        CAPTURED_LIST_FIXTURE.id,
      )
    })

    it('throws BadRequestException, without falling back, when Peerly reports the list is still processing', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce(
        CAPTURED_LIST_FIXTURE,
      )
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValueOnce(null)

      await expect(
        service.calculateAmount({
          ...baseMetadata,
          campaignId: 1,
        }),
      ).rejects.toThrow(BadRequestException)

      expect(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).not.toHaveBeenCalled()
      expect(mockPeerlyPhoneListCapture.countRecipients).not.toHaveBeenCalled()
      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when Peerly omits list_id and no peerlyListId is stamped yet', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce({
        ...CAPTURED_LIST_FIXTURE,
        peerlyListId: null,
      })
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValueOnce({
        Data: { list_state: PhoneListState.PROCESSING },
      })

      await expect(
        service.calculateAmount({
          ...baseMetadata,
          campaignId: 1,
        }),
      ).rejects.toThrow(BadRequestException)

      expect(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).not.toHaveBeenCalled()
      expect(mockPeerlyPhoneListCapture.countRecipients).not.toHaveBeenCalled()
      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
    })

    it('falls back to the DB-stamped peerlyListId when Peerly omits list_id', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce(
        CAPTURED_LIST_FIXTURE,
      )
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValueOnce({
        Data: { list_state: PhoneListState.ACTIVE },
      })
      vi.mocked(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).mockResolvedValueOnce({
        ...PHONE_LIST_DETAILS_FIXTURE,
        leads_loaded: 500,
      })
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        contactCount: 500,
        campaignId: 1,
      })

      expect(amount).toBe(calcTextAmountInCents(500))
      expect(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).toHaveBeenCalledWith(CAPTURED_LIST_FIXTURE.peerlyListId)
      expect(mockPeerlyPhoneListCapture.countRecipients).not.toHaveBeenCalled()
    })

    it('honors a list_id of 0 rather than treating it as absent', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce(
        CAPTURED_LIST_FIXTURE,
      )
      vi.mocked(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).mockResolvedValueOnce({
        Data: { list_id: 0, list_state: PhoneListState.ACTIVE },
      })
      vi.mocked(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).mockResolvedValueOnce({
        ...PHONE_LIST_DETAILS_FIXTURE,
        list_id: 0,
        leads_loaded: 500,
      })
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        contactCount: 500,
        campaignId: 1,
      })

      expect(amount).toBe(calcTextAmountInCents(500))
      expect(
        mockPeerlyPhoneListService.getPhoneListDetails,
      ).toHaveBeenCalledWith(0)
    })

    it('bills $0 without falling back when Peerly confirms a legitimate 0 leads_loaded', async () => {
      mockServerLeadsLoaded(0)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        contactCount: 500,
        campaignId: 1,
      })

      expect(amount).toBe(0)
      expect(mockPeerlyPhoneListCapture.countRecipients).not.toHaveBeenCalled()
    })

    it('applies the free-texts discount to the server-derived count, not an understated client count', async () => {
      const serverContactCount = 7000
      mockServerLeadsLoaded(serverContactCount)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)

      const amount = await service.calculateAmount({
        ...baseMetadata,
        contactCount: 100,
        campaignId: 1,
      })

      const billable = serverContactCount - FREE_TEXTS_OFFER.COUNT
      expect(amount).toBe(calcTextAmountInCents(billable))
    })

    it('throws BadRequestException before checking campaign eligibility when phoneListToken is missing', async () => {
      await expect(
        service.calculateAmount({
          ...baseMetadata,
          phoneListToken: undefined,
          campaignId: 1,
        }),
      ).rejects.toThrow(BadRequestException)

      expect(mockPeerlyPhoneListCapture.findFirst).not.toHaveBeenCalled()
      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when no phone list is found for the token', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce(
        null,
      )

      await expect(
        service.calculateAmount({
          ...baseMetadata,
          campaignId: 1,
        }),
      ).rejects.toThrow(BadRequestException)

      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when neither Peerly nor the captured rows have a count', async () => {
      mockServerFallbackCount(0)

      await expect(
        service.calculateAmount({
          ...baseMetadata,
          campaignId: 1,
        }),
      ).rejects.toThrow(BadRequestException)

      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
    })
  })

  describe('calculateDiscount', () => {
    it('returns 0 for non-p2p outreachType', async () => {
      const discount = await service.calculateDiscount(500, 1, 'text')

      expect(discount).toBe(0)
    })

    it('returns 0 when campaignId is missing', async () => {
      const discount = await service.calculateDiscount(500, undefined, 'p2p')

      expect(discount).toBe(0)
    })

    it('returns 0 when campaign has no offer', async () => {
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValue(false)

      const discount = await service.calculateDiscount(500, 1, 'p2p')

      expect(discount).toBe(0)
    })

    it('caps discount at FREE_TEXTS_OFFER.COUNT when contactCount exceeds it', async () => {
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValue(true)

      const discount = await service.calculateDiscount(10000, 1, 'p2p')

      expect(discount).toBe(calcTextAmountInCents(FREE_TEXTS_OFFER.COUNT))
    })

    it('discounts actual contactCount when below FREE_TEXTS_OFFER.COUNT', async () => {
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValue(true)

      const discount = await service.calculateDiscount(200, 1, 'p2p')

      expect(discount).toBe(calcTextAmountInCents(200))
    })
  })

  describe('executePaymentFailed', () => {
    it('fails the draft the session names, scoped to its campaign', async () => {
      await service.executePaymentFailed('cs_failed', {
        ...baseMetadata,
        campaignId: '111',
        outreachId: '123',
      })

      expect(
        mockOutreachService.failOutreachPurchase,
      ).toHaveBeenCalledExactlyOnceWith(123, 111, 'cs_failed')
    })

    it('ignores a session with no draft to unwind', async () => {
      await service.executePaymentFailed('cs_failed', {
        ...baseMetadata,
        campaignId: 111,
      })

      expect(mockOutreachService.failOutreachPurchase).not.toHaveBeenCalled()
    })
  })

  describe('executePostPurchase', () => {
    const purchaseMetadata = {
      ...baseMetadata,
      campaignId: 111,
    }

    it('records a real checkout session on the row after finalize', async () => {
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      await service.executePostPurchase('cs_test_session_1', {
        ...purchaseMetadata,
        outreachId: '123',
      })

      expect(mockOutreachService.recordCheckoutSession).toHaveBeenCalledWith(
        123,
        111,
        'cs_test_session_1',
      )
    })

    it('records the zero-amount marker as a free purchase, not a session', async () => {
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      await service.executePostPurchase('free_confirmed_abc', {
        ...purchaseMetadata,
        outreachId: '123',
      })

      expect(mockOutreachService.recordCheckoutSession).not.toHaveBeenCalled()
      expect(mockOutreachService.recordFreePurchase).toHaveBeenCalledWith(
        123,
        111,
        'free_confirmed_abc',
      )
    })

    it('finalizes a string outreachId before redeeming free texts', async () => {
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockOutreachService.markFreeTextsConsumed,
      ).mockResolvedValueOnce(true)

      await service.executePostPurchase('pi_draft', {
        ...purchaseMetadata,
        outreachId: '123',
      })

      // The third argument is what paid for the send, carried so a finalize
      // failure line names the charge somebody may have to refund.
      expect(mockOutreachService.finalizeOutreachPurchase).toHaveBeenCalledWith(
        123,
        111,
        'pi_draft',
      )
      expect(mockCampaignsService.redeemFreeTexts).toHaveBeenCalledWith(111)

      const finalizeOrder = firstOrThrow(
        vi.mocked(mockOutreachService.finalizeOutreachPurchase).mock
          .invocationCallOrder,
      )
      const redeemOrder = firstOrThrow(
        vi.mocked(mockCampaignsService.redeemFreeTexts).mock
          .invocationCallOrder,
      )
      expect(finalizeOrder).toBeLessThan(redeemOrder)
    })

    it('stamps the row consumed server-side before redeeming', async () => {
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockOutreachService.markFreeTextsConsumed,
      ).mockResolvedValueOnce(true)

      await service.executePostPurchase('free_confirmed_xyz', {
        ...purchaseMetadata,
        outreachId: '124',
      })

      expect(mockOutreachService.markFreeTextsConsumed).toHaveBeenCalledWith(
        124,
        111,
      )
      const stampOrder = firstOrThrow(
        vi.mocked(mockOutreachService.markFreeTextsConsumed).mock
          .invocationCallOrder,
      )
      const redeemOrder = firstOrThrow(
        vi.mocked(mockCampaignsService.redeemFreeTexts).mock
          .invocationCallOrder,
      )
      expect(stampOrder).toBeLessThan(redeemOrder)
    })

    it('skips redemption and surfaces the error when the stamp fails', async () => {
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockOutreachService.markFreeTextsConsumed,
      ).mockRejectedValueOnce(new Error('db write failed'))

      await expect(
        service.executePostPurchase('free_confirmed_stamp_fail', {
          ...purchaseMetadata,
          outreachId: '126',
        }),
      ).rejects.toThrow('db write failed')

      expect(mockCampaignsService.redeemFreeTexts).not.toHaveBeenCalled()
    })

    it('surfaces a redemption failure so the webhook retries', async () => {
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockOutreachService.markFreeTextsConsumed,
      ).mockResolvedValueOnce(true)
      vi.mocked(mockCampaignsService.redeemFreeTexts).mockRejectedValueOnce(
        new Error('serialization conflict'),
      )

      await expect(
        service.executePostPurchase('free_confirmed_redeem_fail', {
          ...purchaseMetadata,
          outreachId: '127',
        }),
      ).rejects.toThrow('serialization conflict')
    })

    it('skips redemption when the row cannot be stamped', async () => {
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockOutreachService.markFreeTextsConsumed,
      ).mockResolvedValueOnce(false)

      await service.executePostPurchase('free_confirmed_unstampable', {
        ...purchaseMetadata,
        outreachId: '128',
      })

      expect(mockCampaignsService.redeemFreeTexts).not.toHaveBeenCalled()
    })

    it('does not stamp consumption when no offer was redeemed', async () => {
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      await service.executePostPurchase('cs_test_session_2', {
        ...purchaseMetadata,
        outreachId: '125',
      })

      expect(mockOutreachService.markFreeTextsConsumed).not.toHaveBeenCalled()
    })

    it('rethrows a finalize failure and skips redemption', async () => {
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockRejectedValueOnce(new Error('peerly down'))

      await expect(
        service.executePostPurchase('pi_fail', {
          ...purchaseMetadata,
          outreachId: 123,
        }),
      ).rejects.toThrow('peerly down')

      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
      expect(mockCampaignsService.redeemFreeTexts).not.toHaveBeenCalled()
    })

    it('leaves the offer unredeemed for a legacy no-outreachId session', async () => {
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)

      await service.executePostPurchase('pi_legacy', purchaseMetadata)

      expect(
        mockOutreachService.finalizeOutreachPurchase,
      ).not.toHaveBeenCalled()
      // Consuming the offer with no row to stamp would defeat the cancel
      // path's restore — legacy sessions leave the offer with the candidate.
      expect(mockCampaignsService.redeemFreeTexts).not.toHaveBeenCalled()
      expect(mockOutreachService.markFreeTextsConsumed).not.toHaveBeenCalled()
    })

    it('does nothing for non-p2p outreachType even with an outreachId', async () => {
      await service.executePostPurchase('pi_text', {
        ...purchaseMetadata,
        outreachType: 'text',
        outreachId: 123,
      })

      expect(
        mockOutreachService.finalizeOutreachPurchase,
      ).not.toHaveBeenCalled()
      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
      expect(mockCampaignsService.redeemFreeTexts).not.toHaveBeenCalled()
    })
  })

  describe('Win SMS hold billing (WIN_SMS_HOLD_BILLING)', () => {
    const purchaseMetadata = { ...baseMetadata, campaignId: 111 }

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('flag ON: prices the UNDISCOUNTED amount, skipping the free-texts discount', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      mockServerLeadsLoaded(6000)
      // Eligible for the offer, which the flag-on hold deliberately ignores so
      // the hold covers the full count; the discount is applied at capture.
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValue(true)

      const amount = await service.calculateAmount({
        ...purchaseMetadata,
        contactCount: 6000,
      })

      expect(amount).toBe(calcTextAmountInCents(6000))
      expect(amount).not.toBe(
        calcTextAmountInCents(6000 - FREE_TEXTS_OFFER.COUNT),
      )
      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
      // HARD send cap (D2b): persisted onto the build at session creation so the
      // upload caps to the paid count regardless of the hold-link timing.
      expect(mockPeerlyPhoneListCapture.persistSendCap).toHaveBeenCalledWith(
        CAPTURED_LIST_FIXTURE.id,
        maxTextsForAmountInCents(amount),
      )
    })

    it('flag ON: does NOT persist a send cap for a forgiven ($0) amount (no hold, nothing to cap)', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      // This file has no per-test mock reset, so clear the shared spy before
      // asserting it was never called on THIS path.
      vi.mocked(mockPeerlyPhoneListCapture.persistSendCap).mockClear()
      mockServerLeadsLoaded(10)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValue(false)

      const amount = await service.calculateAmount({
        ...purchaseMetadata,
        contactCount: 10,
      })

      expect(amount).toBe(0)
      expect(mockPeerlyPhoneListCapture.persistSendCap).not.toHaveBeenCalled()
    })

    it('flag OFF: still applies the free-texts discount (inert)', async () => {
      mockServerLeadsLoaded(6000)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)

      const amount = await service.calculateAmount({
        ...purchaseMetadata,
        contactCount: 6000,
      })

      expect(amount).toBe(calcTextAmountInCents(6000 - FREE_TEXTS_OFFER.COUNT))
    })

    it('flag ON: forgives a sub-50c undiscounted amount (no hold, amount 0)', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      // 10 texts = 35c undiscounted, below Stripe's 50c authorization floor.
      mockServerLeadsLoaded(10)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValue(false)

      const amount = await service.calculateAmount({
        ...purchaseMetadata,
        contactCount: 10,
      })

      expect(amount).toBe(0)
      // Would otherwise bill the full 35c with no offer.
      expect(calcTextAmountInCents(10)).toBe(35)
    })

    // --- PRE-BUILD estimate (slice D2a): pay before the list is built. ---
    //
    // This file has no per-test mock reset, so an unconsumed `...Once` queue
    // leaks into the next test. These helpers queue exactly what each path
    // consumes, in order: the build-row lookup (carrying the request snapshot the
    // estimate now reads), then the saved-filter lookup, then the has-cell count.

    // A build NOT yet `ready`, carrying the request snapshot the build will
    // re-resolve — the estimate reads THIS, not the row's voterFileFilterId
    // column, so it prices the same merged filter the build resolves.
    const queuePreBuildRow = (
      requestSnapshot: Record<string, unknown> | null,
    ) => {
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce({
        ...CAPTURED_LIST_FIXTURE,
        buildStatus: 'processing',
        peerlyListId: null,
        requestSnapshot: requestSnapshot as never,
      })
    }

    const queueSavedFilter = (savedFilter: Record<string, unknown> | null) => {
      vi.mocked(
        mockVoterFileFilterService.findByIdAndOrganizationSlug,
      ).mockResolvedValueOnce(savedFilter as never)
    }

    const queueCount = (totalResults: number) => {
      vi.mocked(mockOrganizationsService.findFirst).mockResolvedValueOnce({
        slug: CAPTURED_LIST_FIXTURE.organizationSlug,
      } as never)
      vi.mocked(
        mockContactsService.findContactsForFilter,
      ).mockResolvedValueOnce({
        people: [],
        pagination: { totalResults },
      } as never)
    }

    it('flag ON + build NOT ready: holds the UNDISCOUNTED has-cell count of the merged filter, not a live leads_loaded fetch', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      queuePreBuildRow({ name: 'x', voterFileFilterId: 55 })
      queueSavedFilter({ id: 55, search: null })
      queueCount(5000)

      const amount = await service.calculateAmount({
        ...purchaseMetadata,
        contactCount: 4000,
      })

      // Priced off the merged-filter has-cell count, undiscounted — the upper
      // bound the hold authorizes before the list exists.
      expect(amount).toBe(calcTextAmountInCents(5000))
      // HARD send cap (D2b): the pre-build path persists the cap onto the build
      // at session creation — BEFORE the webhook link — so the background build
      // upload caps to it even if it resolves before the hold links.
      expect(mockPeerlyPhoneListCapture.persistSendCap).toHaveBeenCalledWith(
        CAPTURED_LIST_FIXTURE.id,
        maxTextsForAmountInCents(amount),
      )
      // Counted the SAME way the build does: findContactsForFilter with
      // hasCellPhone forced, never a saved-filter-only aggregate.
      expect(mockContactsService.findContactsForFilter).toHaveBeenCalledWith(
        expect.objectContaining({ hasCellPhone: true }),
        { resultsPerPage: 1, page: 1 },
        expect.objectContaining({
          slug: CAPTURED_LIST_FIXTURE.organizationSlug,
        }),
      )
      // No build yet, so the live Peerly leads_loaded fetch is never attempted.
      expect(
        mockPeerlyPhoneListService.checkPhoneListStatus,
      ).not.toHaveBeenCalled()
    })

    it('flag ON + build NOT ready: estimate reflects a snapshot that WIDENS the saved filter (search null overrides a saved search) — the upper bound holds', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      // Saved filter is narrowed by a search term; the round-tripped build request
      // sends search: null, so the build resolves a WIDER audience. The estimate
      // must count that merged (wider) filter, not the saved narrowing.
      queuePreBuildRow({ name: 'x', voterFileFilterId: 55, search: null })
      queueSavedFilter({ id: 55, search: 'narrow-term' })
      queueCount(9000)

      const amount = await service.calculateAmount({
        ...purchaseMetadata,
        contactCount: 4000,
      })

      expect(amount).toBe(calcTextAmountInCents(9000))
      // The count ran against the MERGED filter: the snapshot's null search
      // overrides the saved narrowing, so the wider audience is what was priced.
      expect(mockContactsService.findContactsForFilter).toHaveBeenCalledWith(
        expect.objectContaining({ search: null, hasCellPhone: true }),
        { resultsPerPage: 1, page: 1 },
        expect.anything(),
      )
    })

    it('flag ON + build NOT ready: requires build-ready when the estimate is a free ($0/sub-50c) send', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      // 10 reachable = 35c, below Stripe's 50c floor: a pre-build free send would
      // place no hold and strand, so it is refused until the build is ready.
      queuePreBuildRow({ name: 'x', voterFileFilterId: 55 })
      queueSavedFilter({ id: 55, search: null })
      queueCount(10)

      await expect(
        service.calculateAmount({ ...purchaseMetadata, contactCount: 10 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('flag ON + build NOT ready: rejects a pre-build pay with no saved voter list in the snapshot', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      // Snapshot carries no voterFileFilterId: throws BEFORE any filter/count
      // read, so none is queued.
      queuePreBuildRow({ name: 'x' })

      await expect(
        service.calculateAmount({ ...purchaseMetadata, contactCount: 4000 }),
      ).rejects.toThrow(BadRequestException)
      expect(
        mockVoterFileFilterService.findByIdAndOrganizationSlug,
      ).not.toHaveBeenCalled()
      expect(mockContactsService.findContactsForFilter).not.toHaveBeenCalled()
    })

    it('flag ON + build NOT ready: fails closed on a missing/invalid request snapshot', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      // A null snapshot is what the async build itself would reject (park failed),
      // so the estimate must not fall back to some other filter — it throws.
      queuePreBuildRow(null)

      await expect(
        service.calculateAmount({ ...purchaseMetadata, contactCount: 4000 }),
      ).rejects.toThrow(BadRequestException)
      expect(
        mockVoterFileFilterService.findByIdAndOrganizationSlug,
      ).not.toHaveBeenCalled()
    })

    it('flag ON + build NOT ready: fails closed when the snapshot references a filter this org cannot see', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      queuePreBuildRow({ name: 'x', voterFileFilterId: 55 })
      queueSavedFilter(null)

      await expect(
        service.calculateAmount({ ...purchaseMetadata, contactCount: 4000 }),
      ).rejects.toThrow(BadRequestException)
      // Never counts off an unresolved filter.
      expect(mockContactsService.findContactsForFilter).not.toHaveBeenCalled()
    })

    it('flag ON + build FAILED: refuses checkout (a hold would strand — no build-ready edge)', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce({
        ...CAPTURED_LIST_FIXTURE,
        buildStatus: 'failed',
        peerlyListId: null,
        voterFileFilterId: 55,
      })

      await expect(
        service.calculateAmount({ ...purchaseMetadata, contactCount: 4000 }),
      ).rejects.toThrow(BadRequestException)
      // Rejected on build status alone — never reaches the estimate (no filter
      // lookup, no count).
      expect(
        mockVoterFileFilterService.findByIdAndOrganizationSlug,
      ).not.toHaveBeenCalled()
      expect(mockContactsService.findContactsForFilter).not.toHaveBeenCalled()
    })

    it('flag ON + build NOT ready: refuses a filter over the phone-list limit (a hold would strand — the build cannot complete)', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      queuePreBuildRow({ name: 'x', voterFileFilterId: 55 })
      queueSavedFilter({ id: 55, search: null })
      queueCount(MAX_AUDIENCE_RECIPIENTS + 1)

      await expect(
        service.calculateAmount({ ...purchaseMetadata, contactCount: 4000 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('flag ON + build ready: still bills the final leads_loaded basis, not the match-count estimate', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      // CAPTURED_LIST_FIXTURE is `ready`, so the ready path runs the live fetch.
      mockServerLeadsLoaded(500)

      const amount = await service.calculateAmount({
        ...purchaseMetadata,
        contactCount: 500,
      })

      expect(amount).toBe(calcTextAmountInCents(500))
      // The ready path never reaches the pre-build match-count estimate.
      expect(mockContactsService.findContactsForFilter).not.toHaveBeenCalled()
    })

    it('flag ON: records the hold before finalizing a paid (cs_) session', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      await service.executePostPurchase('cs_hold_1', {
        ...purchaseMetadata,
        outreachId: '123',
      })

      expect(mockP2pSmsHold.recordHold).toHaveBeenCalledWith({
        outreachId: 123,
        checkoutSessionId: 'cs_hold_1',
        // The upload token from checkout metadata, so recordHold can link the
        // satellite to its building phone list at hold time.
        phoneListToken: 'token-abc',
        // Absent on the token path; the campaign is passed so the buildId path
        // can scope its link (see the async-build suite below).
        phoneListBuildId: undefined,
        campaignId: 111,
      })
    })

    it('flag ON: fires the capture edge for a paid (cs_) hold session', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      await service.executePostPurchase('cs_hold_capture', {
        ...purchaseMetadata,
        outreachId: '123',
      })

      expect(mockP2pSmsCapture.captureHold).toHaveBeenCalledWith(123)
    })

    it('flag ON + paid session: passes the outreachId so redeemFreeTexts can stamp the winner atomically', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockOutreachService.markFreeTextsConsumed,
      ).mockResolvedValueOnce(true)

      await service.executePostPurchase('cs_hold_offer', {
        ...purchaseMetadata,
        outreachId: '123',
      })

      // No separate pre-stamp call: the per-send satellite flag is only ever
      // set by redeemFreeTexts itself, inside the same transaction as the
      // campaign CAS win, so a losing concurrent send can never end up stamped.
      expect(mockCampaignsService.redeemFreeTexts).toHaveBeenCalledWith(
        111,
        123,
      )
    })

    it('flag ON + free (non cs_) session: redeems without a winSmsHoldOutreachId', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockOutreachService.markFreeTextsConsumed,
      ).mockResolvedValueOnce(true)

      await service.executePostPurchase('free_confirmed_hold_offer', {
        ...purchaseMetadata,
        outreachId: '123',
      })

      // A forgiven/free send never places a hold, so there is no satellite
      // signal to stamp — redeeming must not pass an outreachId.
      expect(mockCampaignsService.redeemFreeTexts).toHaveBeenCalledWith(111)
    })

    it('flag OFF: never records a hold or fires capture (inert)', async () => {
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      await service.executePostPurchase('cs_hold_2', {
        ...purchaseMetadata,
        outreachId: '123',
      })

      expect(mockP2pSmsHold.recordHold).not.toHaveBeenCalled()
      expect(mockP2pSmsCapture.captureHold).not.toHaveBeenCalled()
    })

    it('flag ON: places no hold and fires no capture on the zero-amount free path', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      await service.executePostPurchase('free_confirmed_abc', {
        ...purchaseMetadata,
        outreachId: '123',
      })

      expect(mockP2pSmsHold.recordHold).not.toHaveBeenCalled()
      expect(mockP2pSmsCapture.captureHold).not.toHaveBeenCalled()
    })

    // --- ASYNC build (slice G): pay off the build id when the async build
    // returned no token. The build id IS the PeerlyPhoneList row id, so the
    // whole billing/cap/link machinery resolves the SAME row the token path
    // would — but the id is client-supplied, so every lookup is scoped to the
    // server-validated campaign (campaignId 111 here).

    it('flag ON + buildId (no token), build ready: bills leads_loaded and persists the cap, scoped to the campaign', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      // CAPTURED_LIST_FIXTURE is `ready` and carries token 'token-abc'; the
      // buildId path resolves the row by id, then bills off the row's OWN token.
      mockServerLeadsLoaded(500)

      const amount = await service.calculateAmount({
        ...purchaseMetadata,
        phoneListToken: undefined,
        phoneListBuildId: 'build-xyz',
        contactCount: 500,
      })

      expect(amount).toBe(calcTextAmountInCents(500))
      // The lookup is scoped to the authenticated campaign — the ownership proof.
      expect(mockPeerlyPhoneListCapture.findFirst).toHaveBeenCalledWith({
        where: { id: 'build-xyz', campaignId: 111 },
      })
      expect(mockPeerlyPhoneListCapture.persistSendCap).toHaveBeenCalledWith(
        CAPTURED_LIST_FIXTURE.id,
        maxTextsForAmountInCents(amount),
      )
    })

    it('flag ON + buildId (no token), build NOT ready: bills the merged-filter estimate and persists the cap', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      queuePreBuildRow({ name: 'x', voterFileFilterId: 55 })
      queueSavedFilter({ id: 55, search: null })
      queueCount(5000)

      const amount = await service.calculateAmount({
        ...purchaseMetadata,
        phoneListToken: undefined,
        phoneListBuildId: 'build-xyz',
        contactCount: 4000,
      })

      expect(amount).toBe(calcTextAmountInCents(5000))
      expect(mockPeerlyPhoneListCapture.findFirst).toHaveBeenCalledWith({
        where: { id: 'build-xyz', campaignId: 111 },
      })
      expect(mockPeerlyPhoneListCapture.persistSendCap).toHaveBeenCalledWith(
        CAPTURED_LIST_FIXTURE.id,
        maxTextsForAmountInCents(amount),
      )
    })

    it('flag ON + buildId belonging to ANOTHER campaign: refuses, never bills, caps, or checks eligibility', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      vi.mocked(mockPeerlyPhoneListCapture.persistSendCap).mockClear()
      vi.mocked(mockCampaignsService.checkFreeTextsEligibility).mockClear()
      // The {id, campaignId} lookup finds nothing because the row's campaignId is
      // not 111 — a client-supplied id that is not this campaign's list.
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockResolvedValueOnce(
        null,
      )

      await expect(
        service.calculateAmount({
          ...purchaseMetadata,
          phoneListToken: undefined,
          phoneListBuildId: 'build-foreign',
        }),
      ).rejects.toThrow(BadRequestException)

      // Proven campaign-scoped: the refused id was looked up with campaignId 111,
      // so an unowned id can never resolve a row to bill or cap against.
      expect(mockPeerlyPhoneListCapture.findFirst).toHaveBeenCalledWith({
        where: { id: 'build-foreign', campaignId: 111 },
      })
      expect(mockPeerlyPhoneListCapture.persistSendCap).not.toHaveBeenCalled()
      expect(
        mockCampaignsService.checkFreeTextsEligibility,
      ).not.toHaveBeenCalled()
    })

    it('flag ON + token AND buildId present: the token path wins (buildId ignored), unchanged', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      // Earlier async tests already queried findFirst by id; clear the history so
      // the "id was never consulted" assertion reflects only this call.
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockClear()
      mockServerLeadsLoaded(6000)

      const amount = await service.calculateAmount({
        ...purchaseMetadata,
        phoneListToken: 'token-abc',
        phoneListBuildId: 'build-xyz',
        contactCount: 6000,
      })

      expect(amount).toBe(calcTextAmountInCents(6000))
      // Resolved by token, scoped to campaign — the id is not consulted.
      expect(mockPeerlyPhoneListCapture.findFirst).toHaveBeenCalledWith({
        where: { token: 'token-abc', campaignId: 111 },
      })
      expect(mockPeerlyPhoneListCapture.findFirst).not.toHaveBeenCalledWith({
        where: { id: 'build-xyz', campaignId: 111 },
      })
    })

    it('flag OFF + buildId (no token): ignores the buildId entirely (byte-for-byte pre-slice behavior), never resolves by id', async () => {
      vi.mocked(mockPeerlyPhoneListCapture.persistSendCap).mockClear()
      vi.mocked(mockPeerlyPhoneListCapture.findFirst).mockClear()

      // The buildId handle only exists for the async-build path gated behind
      // WIN_SMS_HOLD_BILLING. Flag off must behave exactly as it did before
      // that slice — token-only — so a crafted buildId with no token is the
      // same as supplying neither handle: refused before any lookup.
      await expect(
        service.calculateAmount({
          ...purchaseMetadata,
          phoneListToken: undefined,
          phoneListBuildId: 'build-xyz',
          contactCount: 6000,
        }),
      ).rejects.toThrow(BadRequestException)

      expect(mockPeerlyPhoneListCapture.findFirst).not.toHaveBeenCalled()
      expect(mockPeerlyPhoneListCapture.persistSendCap).not.toHaveBeenCalled()
    })

    it('flag OFF + token AND buildId present: resolves by token only (buildId ignored), unchanged', async () => {
      mockServerLeadsLoaded(6000)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)

      const amount = await service.calculateAmount({
        ...purchaseMetadata,
        phoneListToken: 'token-abc',
        phoneListBuildId: 'build-xyz',
        contactCount: 6000,
      })

      expect(amount).toBe(calcTextAmountInCents(6000 - FREE_TEXTS_OFFER.COUNT))
      expect(mockPeerlyPhoneListCapture.findFirst).toHaveBeenCalledWith({
        where: { token: 'token-abc', campaignId: 111 },
      })
      expect(mockPeerlyPhoneListCapture.findFirst).not.toHaveBeenCalledWith({
        where: { id: 'build-xyz', campaignId: 111 },
      })
      expect(mockPeerlyPhoneListCapture.persistSendCap).not.toHaveBeenCalled()
    })

    it('flag ON: passes the buildId (and campaign) to recordHold on a paid (cs_) session with no token', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(true)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(false)

      await service.executePostPurchase('cs_hold_bid', {
        ...purchaseMetadata,
        phoneListToken: undefined,
        phoneListBuildId: 'build-xyz',
        outreachId: '123',
      })

      expect(mockP2pSmsHold.recordHold).toHaveBeenCalledWith({
        outreachId: 123,
        checkoutSessionId: 'cs_hold_bid',
        phoneListToken: undefined,
        // The build id links the satellite in place of the (absent) token,
        // scoped to the campaign the hold belongs to.
        phoneListBuildId: 'build-xyz',
        campaignId: 111,
      })
    })
  })
})

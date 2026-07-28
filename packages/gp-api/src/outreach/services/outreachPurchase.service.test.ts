import { BadRequestException } from '@nestjs/common'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { FREE_TEXTS_OFFER } from '@/shared/constants/freeTextsOffer'
import {
  calcTextAmountInCents,
  PRICE_PER_TEXT_TENTH_CENTS,
} from '@/shared/util/textPricing.util'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { PeerlyPhoneList } from 'src/generated/prisma'
import { PhoneListState } from 'src/vendors/peerly/peerly.types'
import { PeerlyPhoneListCaptureService } from 'src/vendors/peerly/services/peerlyPhoneListCapture.service'
import { PeerlyPhoneListService } from 'src/vendors/peerly/services/peerlyPhoneList.service'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { OutreachPurchaseMetadata } from '../types/outreach.types'
import { OutreachService } from './outreach.service'
import { OutreachPurchaseHandlerService } from './outreachPurchase.service'
import { describe, expect, it, vi } from 'vitest'

const mockCampaignsService = {
  checkFreeTextsEligibility: vi.fn(),
  redeemFreeTexts: vi.fn(),
} as unknown as CampaignsService

const mockOutreachService = {
  finalizeOutreachPurchase: vi.fn(),
} as unknown as OutreachService

const mockPeerlyPhoneListService = {
  checkPhoneListStatus: vi.fn(),
  getPhoneListDetails: vi.fn(),
} as unknown as PeerlyPhoneListService

const mockPeerlyPhoneListCapture = {
  findFirst: vi.fn(),
  countRecipients: vi.fn(),
} as unknown as PeerlyPhoneListCaptureService

const mockLogger = createMockLogger()

const service = new OutreachPurchaseHandlerService(
  mockCampaignsService,
  mockOutreachService,
  mockPeerlyPhoneListService,
  mockPeerlyPhoneListCapture,
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
  organizationSlug: 'org-1',
  campaignId: 1,
  token: 'token-abc',
  peerlyListId: 42,
  voterFileFilterId: null,
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

    it('falls back to the captured recipient count when the Peerly fetch throws', async () => {
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

  describe('executePostPurchase', () => {
    const purchaseMetadata = {
      ...baseMetadata,
      campaignId: 111,
    }

    it('finalizes a string outreachId before redeeming free texts', async () => {
      vi.mocked(
        mockOutreachService.finalizeOutreachPurchase,
      ).mockResolvedValueOnce(undefined)
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)

      await service.executePostPurchase('pi_draft', {
        ...purchaseMetadata,
        outreachId: '123',
      })

      expect(mockOutreachService.finalizeOutreachPurchase).toHaveBeenCalledWith(
        123,
        111,
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

    it('runs legacy redemption when metadata has no outreachId', async () => {
      vi.mocked(
        mockCampaignsService.checkFreeTextsEligibility,
      ).mockResolvedValueOnce(true)

      await service.executePostPurchase('pi_legacy', purchaseMetadata)

      expect(
        mockOutreachService.finalizeOutreachPurchase,
      ).not.toHaveBeenCalled()
      expect(mockCampaignsService.redeemFreeTexts).toHaveBeenCalledWith(111)
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
})

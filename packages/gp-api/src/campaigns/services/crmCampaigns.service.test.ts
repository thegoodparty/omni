import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { HubspotService } from '@/crm/hubspot.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CrmCampaignsService } from './crmCampaigns.service'
import { CampaignsService } from './campaigns.service'

describe('CrmCampaignsService.trackCampaign', () => {
  const findUniqueOrThrow = vi.fn()
  const errorMessage = vi.fn()

  const buildService = (isConfigured: boolean) =>
    new CrmCampaignsService(
      { findUniqueOrThrow } as unknown as CampaignsService,
      {} as never,
      { isConfigured } as unknown as HubspotService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { errorMessage } as unknown as SlackService,
      {} as never,
      createMockLogger(),
    )

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips all HubSpot work and alerts when HubSpot is not configured', async () => {
    const result = await buildService(false).trackCampaign(123)

    expect(result).toBeUndefined()
    expect(findUniqueOrThrow).not.toHaveBeenCalled()
    expect(errorMessage).not.toHaveBeenCalled()
  })

  it('proceeds to load the campaign when HubSpot is configured', async () => {
    findUniqueOrThrow.mockRejectedValueOnce(new Error('stop here'))

    await expect(buildService(true).trackCampaign(123)).rejects.toThrow(
      'stop here',
    )
    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 123 } })
  })
})

describe('CrmCampaignsService 10DLC filing properties', () => {
  const campaign = {
    id: 5,
    userId: 1,
    isActive: true,
    isPro: true,
    organizationSlug: null,
    data: { hubspotId: 'hs-1' },
    details: {},
    aiContent: null,
  }
  const user = {
    id: 1,
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    metaData: {},
  }

  const findUniqueOrThrow = vi.fn().mockResolvedValue(campaign)
  const tcrFindUnique = vi.fn()
  const companyUpdate = vi.fn().mockResolvedValue({ id: 'hs-1' })

  const buildService = () =>
    new CrmCampaignsService(
      {
        findUniqueOrThrow,
        fetchLiveRaceTargetMetrics: vi.fn().mockResolvedValue(null),
        client: { tcrCompliance: { findUnique: tcrFindUnique } },
      } as unknown as CampaignsService,
      { findByCampaign: vi.fn().mockResolvedValue(user) } as never,
      {
        isConfigured: true,
        client: { crm: { companies: { basicApi: { update: companyUpdate } } } },
      } as unknown as HubspotService,
      {} as never,
      {} as never,
      { count: vi.fn().mockResolvedValue(0) } as never,
      { canDownload: vi.fn().mockReturnValue(false) } as never,
      { errorMessage: vi.fn() } as unknown as SlackService,
      { findByCampaignId: vi.fn().mockResolvedValue(null) } as never,
      createMockLogger(),
    )

  beforeEach(() => {
    vi.clearAllMocks()
    findUniqueOrThrow.mockResolvedValue(campaign)
    companyUpdate.mockResolvedValue({ id: 'hs-1' })
  })

  it('syncs TCR filing and PIN delivery fields to the HubSpot company', async () => {
    tcrFindUnique.mockResolvedValue({
      email: 'filing@example.com',
      phone: '5555551234',
      filingUrl: 'https://sos.example.gov/filing/jane',
      pinDeliveryMethod: 'email',
      pinDeliveryDestination: 'treasurer@example.com',
      pinSentDetectedAt: new Date('2026-07-21T04:08:04Z'),
    })

    await buildService().trackCampaign(5)

    expect(tcrFindUnique).toHaveBeenCalledWith({
      where: { campaignId: 5 },
      select: {
        email: true,
        phone: true,
        filingUrl: true,
        pinDeliveryMethod: true,
        pinDeliveryDestination: true,
        pinSentDetectedAt: true,
      },
    })
    expect(companyUpdate).toHaveBeenCalledWith('hs-1', {
      properties: expect.objectContaining({
        n10_dlc_filing_email: 'filing@example.com',
        n10_dlc_filing_phone: '5555551234',
        n10_dlc_filing_url: 'https://sos.example.gov/filing/jane',
        n10_dlc_pin_delivery_method: 'email',
        n10_dlc_pin_delivery_destination: 'treasurer@example.com',
        n10_dlc_pin_sent_at: String(Date.UTC(2026, 6, 21)),
      }),
    })
  })

  it('omits PIN delivery fields when the PIN has not been detected yet', async () => {
    tcrFindUnique.mockResolvedValue({
      email: 'filing@example.com',
      phone: '5555551234',
      filingUrl: 'https://sos.example.gov/filing/jane',
      pinDeliveryMethod: null,
      pinDeliveryDestination: null,
      pinSentDetectedAt: null,
    })

    await buildService().trackCampaign(5)

    expect(companyUpdate).toHaveBeenCalledTimes(1)
    const properties = companyUpdate.mock.calls.at(0)?.[1].properties
    expect(properties).not.toHaveProperty('n10_dlc_pin_delivery_method')
    expect(properties).not.toHaveProperty('n10_dlc_pin_sent_at')
    expect(properties).not.toHaveProperty('n10_dlc_pin_delivery_destination')
  })

  it('omits the filing properties when no TCR record exists', async () => {
    tcrFindUnique.mockResolvedValue(null)

    await buildService().trackCampaign(5)

    expect(companyUpdate).toHaveBeenCalledTimes(1)
    const properties = companyUpdate.mock.calls.at(0)?.[1].properties
    expect(properties).not.toHaveProperty('n10_dlc_filing_email')
    expect(properties).not.toHaveProperty('n10_dlc_filing_phone')
    expect(properties).not.toHaveProperty('n10_dlc_filing_url')
  })
})

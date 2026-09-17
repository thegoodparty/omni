import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadGatewayException } from '@nestjs/common'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { AdminCampaignsService } from './adminCampaigns.service'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { VoterFileDownloadAccessService } from '../../shared/services/voterFileDownloadAccess.service'
import { CrmCampaignsService } from '../../campaigns/services/crmCampaigns.service'
import { StripeService } from '../../vendors/stripe/services/stripe.service'
import { Campaign } from '../../generated/prisma'

describe('AdminCampaignsService.proNoVoterFile', () => {
  const findMany = vi.fn()
  const getDistrictAndBallotLevelForOrgSlug = vi.fn()
  const canDownload = vi.fn()
  const logger = createMockLogger()

  const buildService = () =>
    new AdminCampaignsService(
      {} as never,
      {} as never,
      { findMany } as unknown as CampaignsService,
      { canDownload } as unknown as VoterFileDownloadAccessService,
      {} as never,
      {} as never,
      {} as never,
      {
        getDistrictAndBallotLevelForOrgSlug,
      } as unknown as OrganizationsService,
      {} as never,
      logger,
    )

  const campaign = (
    overrides: Omit<Partial<Campaign>, 'organizationSlug'> & {
      organizationSlug?: string | null
    },
  ): Campaign =>
    ({ id: 1, organizationSlug: 'org-a', ...overrides }) as Campaign

  beforeEach(() => {
    vi.clearAllMocks()
    // canDownload would say "yes" — the point is that a rejected resolve must
    // NOT reach it (fail closed), so the campaign stays on the audit list.
    canDownload.mockReturnValue(true)
  })

  it('keeps a campaign on the blocked list when its level resolve rejects (fail closed)', async () => {
    findMany.mockResolvedValue([
      campaign({ id: 1, organizationSlug: 'rejects' }),
      campaign({ id: 2, organizationSlug: 'resolves' }),
    ])
    getDistrictAndBallotLevelForOrgSlug.mockImplementation((slug: string) =>
      slug === 'rejects'
        ? Promise.reject(new Error('election-api down'))
        : Promise.resolve({ district: null, ballotLevel: 'CITY' }),
    )

    const result = await buildService().proNoVoterFile()

    // id:1 resolve rejected -> included despite canDownload returning true.
    // id:2 resolved + canDownload true -> excluded.
    expect(result.map((c) => c.id)).toEqual([1])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 1 }),
      expect.stringContaining('treating as blocked'),
    )
  })

  it('keeps a campaign with no organizationSlug on the blocked list (fail closed)', async () => {
    findMany.mockResolvedValue([
      campaign({ id: 5, organizationSlug: null }),
      campaign({ id: 6, organizationSlug: 'resolves' }),
    ])
    getDistrictAndBallotLevelForOrgSlug.mockResolvedValue({
      district: null,
      ballotLevel: 'CITY',
    })

    const result = await buildService().proNoVoterFile()

    // id:5 has no org -> no authoritative level -> fail closed (included)
    // without ever consulting canDownload (which would trust details).
    expect(result.map((c) => c.id)).toEqual([5])
    expect(getDistrictAndBallotLevelForOrgSlug).not.toHaveBeenCalledWith(null)
    expect(canDownload).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 5 }),
      expect.anything(),
      expect.anything(),
    )
    // id:6 resolved -> it IS routed through canDownload (and excluded because
    // the mock returns true), proving id:5's exclusion-skip is the fail-closed
    // branch, not a blanket skip.
    expect(canDownload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 6 }),
      null,
      'CITY',
    )
  })
})

describe('AdminCampaignsService.update — Stripe subscription cancel on de-Pro', () => {
  const findUniqueOrThrow = vi.fn()
  const update = vi.fn()
  const trackCampaign = vi.fn()
  const cancelSubscription = vi.fn()
  const track = vi.fn()
  const logger = createMockLogger()

  const buildService = () =>
    new AdminCampaignsService(
      {} as never,
      {} as never,
      {
        findUniqueOrThrow,
        update,
      } as unknown as CampaignsService,
      {} as never,
      { trackCampaign } as unknown as CrmCampaignsService,
      {} as never,
      { track } as never,
      {} as never,
      { cancelSubscription } as unknown as StripeService,
      logger,
    )

  beforeEach(() => {
    vi.clearAllMocks()
    update.mockResolvedValue({ id: 42, userId: 7 })
    trackCampaign.mockResolvedValue(undefined)
    cancelSubscription.mockResolvedValue({ id: 'sub_test' })
    track.mockResolvedValue(undefined)
  })

  it('cancels the Stripe subscription when admin sets isPro:false on a paying campaign', async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: 42,
      details: { subscriptionId: 'sub_live_123' },
    })

    await buildService().update(42, { isPro: false })

    expect(cancelSubscription).toHaveBeenCalledWith('sub_live_123')
    // DB write still happens after a successful cancel so admin state moves
    // immediately; the webhook then clears details.subscriptionId.
    expect(update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: expect.objectContaining({ isPro: false }),
    })
  })

  it('does not touch Stripe for a comped campaign (isPro:false without subscriptionId)', async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: 42,
      details: {},
    })

    await buildService().update(42, { isPro: false })

    expect(cancelSubscription).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: expect.objectContaining({ isPro: false }),
    })
  })

  it('surfaces a 502 and skips the DB update when Stripe cancel fails', async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: 42,
      details: { subscriptionId: 'sub_live_123' },
    })
    cancelSubscription.mockRejectedValue(
      new BadGatewayException('Failed to cancel subscription sub_live_123'),
    )

    await expect(buildService().update(42, { isPro: false })).rejects.toThrow(
      BadGatewayException,
    )

    // The whole point: if Stripe failed, we must NOT have written isPro:false.
    // Otherwise DB says non-Pro while Stripe keeps billing — the exact
    // divergence this ticket is closing.
    expect(update).not.toHaveBeenCalled()
    expect(trackCampaign).not.toHaveBeenCalled()
  })

  it('does not read the campaign or touch Stripe when isPro is not being changed to false', async () => {
    await buildService().update(42, { isVerified: true })

    expect(findUniqueOrThrow).not.toHaveBeenCalled()
    expect(cancelSubscription).not.toHaveBeenCalled()
  })

  it('does not touch Stripe when isPro is being set to true', async () => {
    await buildService().update(42, { isPro: true })

    expect(findUniqueOrThrow).not.toHaveBeenCalled()
    expect(cancelSubscription).not.toHaveBeenCalled()
  })
})

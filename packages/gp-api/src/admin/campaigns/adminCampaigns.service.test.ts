import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { AdminCampaignsService } from './adminCampaigns.service'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { VoterFileDownloadAccessService } from '../../shared/services/voterFileDownloadAccess.service'
import { Campaign } from '../../generated/prisma'
import { WinOfficeService } from '@/electedOffice/services/winOffice.service'

describe('AdminCampaignsService.proNoVoterFile', () => {
  const findMany = vi.fn()
  const getDistrictAndBallotLevelForOrgSlug = vi.fn()
  const canDownload = vi.fn()
  const logger = createMockLogger()

  const buildService = () =>
    new AdminCampaignsService(
      { findMany } as unknown as CampaignsService,
      { canDownload } as unknown as VoterFileDownloadAccessService,
      {} as never,
      {
        getDistrictAndBallotLevelForOrgSlug,
      } as unknown as OrganizationsService,
      {} as never,
      { reconcile: vi.fn() } as unknown as WinOfficeService,
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

describe('AdminCampaignsService.update', () => {
  const update = vi.fn()
  const logger = createMockLogger()
  const reconcile = vi.fn()

  const buildService = () =>
    new AdminCampaignsService(
      { update } as unknown as CampaignsService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { reconcile } as unknown as WinOfficeService,
      logger,
    )

  beforeEach(() => {
    vi.clearAllMocks()
    update.mockResolvedValue({ id: 42, userId: 7 })
  })

  it('writes verification, with its date, in one update', async () => {
    await buildService().update(42, { isVerified: true })

    expect(update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { isVerified: true, dateVerified: expect.any(Date) },
    })
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('reconciles the win office when didWin changes', async () => {
    await buildService().update(42, { didWin: true })

    expect(update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { didWin: true },
    })
    expect(reconcile).toHaveBeenCalledWith(42, 'staff')
  })
})

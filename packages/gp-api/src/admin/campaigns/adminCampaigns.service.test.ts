import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { AdminCampaignsService } from './adminCampaigns.service'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { VoterFileDownloadAccessService } from '../../shared/services/voterFileDownloadAccess.service'
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
      logger,
    )

  const campaign = (overrides: Partial<Campaign>): Campaign =>
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
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Organization } from '@/generated/prisma'
import type { OrgDistrict } from '@/organizations/organizations.types'
import type { OrganizationsService } from '@/organizations/services/organizations.service'
import { ManagedCivicPanelService } from '@/contacts/services/managedCivicPanel.service'
import type { ContactsService } from '@/contacts/services/contacts.service'
import type { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import type { CensusCompositionSource } from '@/priorities/services/censusComposition'
import type { CensusTractNameService } from '@/contacts/services/censusTractName.service'
import type { AnalyticsService } from '@/analytics/analytics.service'

const asheville: OrgDistrict = {
  id: 'district-1',
  state: 'NC',
  l2Type: 'City',
  l2Name: 'ASHEVILLE CITY',
}

const organization = {
  slug: 'eo-asheville',
  positionId: 'position-1',
  overrideDistrictId: null,
} as Organization

describe('ManagedCivicPanelService.districtPlace', () => {
  const getDistrictForOrgSlug =
    vi.fn<OrganizationsService['getDistrictForOrgSlug']>()
  let panels: ManagedCivicPanelService

  beforeEach(() => {
    getDistrictForOrgSlug.mockReset()
    const organizations: Partial<OrganizationsService> = {
      getDistrictForOrgSlug,
    }
    panels = new ManagedCivicPanelService(
      {} as ContactsService,
      {} as ContactStatusService,
      {} as CensusCompositionSource,
      {} as CensusTractNameService,
      organizations as OrganizationsService,
      {} as AnalyticsService,
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('looks the place up once a day, not on every read', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-30T12:00:00Z') })
    getDistrictForOrgSlug.mockResolvedValue(asheville)

    expect(await panels.districtPlace(organization)).toBe('Asheville')
    expect(await panels.districtPlace(organization)).toBe('Asheville')
    expect(getDistrictForOrgSlug).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-10-31T12:00:01Z'))
    await panels.districtPlace(organization)
    expect(getDistrictForOrgSlug).toHaveBeenCalledTimes(2)
  })

  it('tries again next time when the lookup found no place', async () => {
    getDistrictForOrgSlug
      .mockRejectedValueOnce(new Error('election api down'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(asheville)

    expect(await panels.districtPlace(organization)).toBeNull()
    expect(await panels.districtPlace(organization)).toBeNull()
    expect(await panels.districtPlace(organization)).toBe('Asheville')
    expect(getDistrictForOrgSlug).toHaveBeenCalledTimes(3)
  })

  it('looks the place up again when the office points at another district', async () => {
    getDistrictForOrgSlug.mockResolvedValue(asheville)

    await panels.districtPlace(organization)
    await panels.districtPlace({
      ...organization,
      overrideDistrictId: 'district-2',
    })

    expect(getDistrictForOrgSlug).toHaveBeenCalledTimes(2)
  })
})

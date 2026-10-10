import { BadRequestException } from '@nestjs/common'
import { Organization } from '../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { PeopleDatasetService } from '@/peopleDb/services/peopleDataset.service'
import { OnboardingContactsController } from './onboardingContacts.controller'

describe('OnboardingContactsController', () => {
  let controller: OnboardingContactsController
  let resolveDistrictIdFromPosition: ReturnType<typeof vi.fn>
  let fetchStatsByDistrictId: ReturnType<typeof vi.fn>
  let getDistrictAndLevelForOrgSlug: ReturnType<typeof vi.fn>
  let resolveDataset: ReturnType<typeof vi.fn>

  const organization = { slug: 'org-slug' } as Organization
  const stats = { totalConstituents: 1000 }

  beforeEach(() => {
    resolveDistrictIdFromPosition = vi.fn()
    fetchStatsByDistrictId = vi.fn().mockResolvedValue(stats)
    getDistrictAndLevelForOrgSlug = vi.fn()
    resolveDataset = vi.fn().mockResolvedValue('voters')
    controller = new OnboardingContactsController(
      {
        resolveDistrictIdFromPosition,
        fetchStatsByDistrictId,
      } as unknown as ContactsService,
      { getDistrictAndLevelForOrgSlug } as unknown as OrganizationsService,
      { resolve: resolveDataset } as unknown as PeopleDatasetService,
    )
  })

  it('uses an explicit districtId without touching the resolvers', async () => {
    const result = await controller.getOnboardingStats(
      { districtId: 'd-1' },
      organization,
    )

    expect(fetchStatsByDistrictId).toHaveBeenCalledWith('d-1', 'voters')
    expect(resolveDistrictIdFromPosition).not.toHaveBeenCalled()
    expect(getDistrictAndLevelForOrgSlug).not.toHaveBeenCalled()
    expect(result).toEqual(stats)
  })

  it('resolves the district from an explicit BR position id', async () => {
    resolveDistrictIdFromPosition.mockResolvedValue('d-2')

    const result = await controller.getOnboardingStats(
      { ballotReadyPositionId: 'br-pos-1' },
      organization,
    )

    expect(resolveDistrictIdFromPosition).toHaveBeenCalledWith('br-pos-1')
    expect(fetchStatsByDistrictId).toHaveBeenCalledWith('d-2', 'voters')
    expect(getDistrictAndLevelForOrgSlug).not.toHaveBeenCalled()
    expect(result).toEqual(stats)
  })

  it('falls back to the org-derived district when no params are sent', async () => {
    // The org's position pointer is maintained on race edits, so this path
    // is what keeps voter insights current after an office change.
    getDistrictAndLevelForOrgSlug.mockResolvedValue({
      district: { id: 'd-3', l2Type: 'City', l2Name: 'Anytown' },
      level: 'local',
    })

    const result = await controller.getOnboardingStats({}, organization)

    expect(getDistrictAndLevelForOrgSlug).toHaveBeenCalledWith('org-slug')
    expect(fetchStatsByDistrictId).toHaveBeenCalledWith('d-3', 'voters')
    expect(result).toEqual(stats)
  })

  it('rejects when nothing resolves a district', async () => {
    getDistrictAndLevelForOrgSlug.mockResolvedValue({
      district: null,
      level: null,
    })

    await expect(
      controller.getOnboardingStats({}, organization),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(fetchStatsByDistrictId).not.toHaveBeenCalled()
  })

  it('rejects anonymous param-less requests without an organization', async () => {
    await expect(
      controller.getOnboardingStats({}, undefined),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(getDistrictAndLevelForOrgSlug).not.toHaveBeenCalled()
  })

  it('reads the table the request organization resolves to', async () => {
    resolveDataset.mockResolvedValue('constituents')
    const serveOrg = { slug: 'eo-council', ownerId: 7 } as Organization

    await controller.getOnboardingStats({ districtId: 'd-4' }, serveOrg)

    expect(resolveDataset).toHaveBeenCalledWith(serveOrg)
    expect(fetchStatsByDistrictId).toHaveBeenCalledWith('d-4', 'constituents')
  })

  it('reads voters for an anonymous request', async () => {
    await controller.getOnboardingStats({ districtId: 'd-5' }, undefined)

    expect(resolveDataset).not.toHaveBeenCalled()
    expect(fetchStatsByDistrictId).toHaveBeenCalledWith('d-5', 'voters')
  })
})

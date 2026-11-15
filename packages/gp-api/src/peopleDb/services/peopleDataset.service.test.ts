import { describe, expect, it, vi } from 'vitest'
import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import type { FeaturesService } from '@/features/services/features.service'
import type { PositionsService } from '@/electionDb/positions/positions.service'
import type { PrismaService } from '@/prisma/prisma.service'
import {
  PeopleDatasetService,
  SERVE_CONSUMER_DATA_FLAG,
} from './peopleDataset.service'

const ORG = {
  slug: 'eo-1',
  ownerId: 7,
  overrideDistrictId: null,
  positionId: 'position-1',
}

const setup = (flags: string[], { hasUploads = true } = {}) => {
  const isFeatureEnabled = vi.fn(({ feature }: { feature: string }) =>
    Promise.resolve(flags.includes(feature)),
  )
  const getPositionById = vi.fn(() =>
    Promise.resolve({ district: { id: 'district-1' } }),
  )
  const findFirst = vi.fn(() =>
    Promise.resolve(hasUploads ? { id: 'match-1' } : null),
  )
  const service = new PeopleDatasetService(
    { isFeatureEnabled } as unknown as FeaturesService,
    { getPositionById } as unknown as PositionsService,
    { contactUploadMatch: { findFirst } } as unknown as PrismaService,
  )
  return { service, isFeatureEnabled, getPositionById, findFirst }
}

describe('PeopleDatasetService.resolve', () => {
  it('reads voters for a Win org without asking the consumer-data flag', async () => {
    const { service, isFeatureEnabled, getPositionById } = setup([
      SERVE_CONSUMER_DATA_FLAG,
    ])

    await expect(
      service.resolve({ ...ORG, slug: 'campaign-1' }),
    ).resolves.toEqual({ base: 'voters' })
    expect(isFeatureEnabled).not.toHaveBeenCalledWith(
      expect.objectContaining({ feature: SERVE_CONSUMER_DATA_FLAG }),
    )
    expect(getPositionById).not.toHaveBeenCalled()
  })

  it('joins a Win org to its imported contacts over voters when the flag is on', async () => {
    const { service, isFeatureEnabled } = setup([
      SERVE_CONSUMER_DATA_FLAG,
      SERVE_IMPORT_CONTACTS_FLAG,
    ])

    await expect(
      service.resolve({ ...ORG, slug: 'campaign-1' }),
    ).resolves.toEqual({
      base: 'voters',
      overlayOrgSlug: 'campaign-1',
      overlayDistrictId: 'district-1',
    })
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: 7,
      feature: SERVE_IMPORT_CONTACTS_FLAG,
    })
  })

  it('has no overlay when serve-import-contacts is off', async () => {
    const { service, getPositionById, findFirst } = setup([
      SERVE_CONSUMER_DATA_FLAG,
    ])

    await expect(service.resolve(ORG)).resolves.toEqual({
      base: 'constituents',
    })
    expect(findFirst).not.toHaveBeenCalled()
    expect(getPositionById).not.toHaveBeenCalled()
  })

  // The overlay is a federated read Databricks never caches, so joining an
  // org that has imported nobody costs every read a full run for no rows.
  it('has no overlay when the flag is on but the org has imported nobody', async () => {
    const { service, getPositionById, findFirst } = setup(
      [SERVE_IMPORT_CONTACTS_FLAG],
      { hasUploads: false },
    )

    await expect(service.resolve(ORG)).resolves.toEqual({ base: 'voters' })
    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationSlug: 'eo-1', personId: { not: null } },
      select: { id: true },
    })
    expect(getPositionById).not.toHaveBeenCalled()
  })

  it('carries the org and its position district when the flag is on', async () => {
    const { service, isFeatureEnabled, getPositionById } = setup([
      SERVE_IMPORT_CONTACTS_FLAG,
    ])

    await expect(service.resolve(ORG)).resolves.toEqual({
      base: 'voters',
      overlayOrgSlug: 'eo-1',
      overlayDistrictId: 'district-1',
    })
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: 7,
      feature: SERVE_IMPORT_CONTACTS_FLAG,
    })
    expect(getPositionById).toHaveBeenCalledWith({
      id: 'position-1',
      includeDistrict: true,
    })
  })

  it('prefers the override district without a position lookup', async () => {
    const { service, getPositionById } = setup([SERVE_IMPORT_CONTACTS_FLAG])

    await expect(
      service.resolve({ ...ORG, overrideDistrictId: 'override-1' }),
    ).resolves.toEqual({
      base: 'voters',
      overlayOrgSlug: 'eo-1',
      overlayDistrictId: 'override-1',
    })
    expect(getPositionById).not.toHaveBeenCalled()
  })
})

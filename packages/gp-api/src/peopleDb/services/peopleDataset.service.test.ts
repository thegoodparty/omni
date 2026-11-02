import { describe, expect, it, vi } from 'vitest'
import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import type { FeaturesService } from '@/features/services/features.service'
import type { PositionsService } from '@/electionDb/positions/positions.service'
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

const setup = (flags: string[]) => {
  const isFeatureEnabled = vi.fn(({ feature }: { feature: string }) =>
    Promise.resolve(flags.includes(feature)),
  )
  const getPositionById = vi.fn(() =>
    Promise.resolve({ district: { id: 'district-1' } }),
  )
  const service = new PeopleDatasetService(
    { isFeatureEnabled } as unknown as FeaturesService,
    { getPositionById } as unknown as PositionsService,
  )
  return { service, isFeatureEnabled, getPositionById }
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
    const { service, getPositionById } = setup([SERVE_CONSUMER_DATA_FLAG])

    await expect(service.resolve(ORG)).resolves.toEqual({
      base: 'constituents',
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

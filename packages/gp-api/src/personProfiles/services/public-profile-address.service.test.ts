import { describe, expect, it, vi } from 'vitest'
import type { PersonProfilesService } from './person-profiles.service'
import type {
  PersonIdentity,
  PersonLookupService,
} from './person-lookup.service'
import {
  PublicProfileAddressService,
  type PublicProfileGate,
} from './public-profile-address.service'

const PERSON_ID = '0189abcd-0000-7000-8000-000000000000'
const URL = 'https://goodparty.org/people/renee-diaz-0189abcd'
const DAY = '2026-10-15'

const published: PublicProfileGate = {
  personId: PERSON_ID,
  publishedAt: new Date('2026-10-01T00:00:00Z'),
  deletedAt: null,
}

const build = (
  identities: Map<string, PersonIdentity> = new Map(),
  removed = false,
) => {
  const isRemoved = vi.fn(() => Promise.resolve(removed))
  const resolveIdentities = vi.fn(() => Promise.resolve(identities))
  const service = new PublicProfileAddressService(
    { isRemoved } as unknown as PersonProfilesService,
    { resolveIdentities } as unknown as PersonLookupService,
  )
  return { service, isRemoved, resolveIdentities }
}

const addressed = (): Map<string, PersonIdentity> =>
  new Map([[PERSON_ID, { fullName: 'Renee Diaz', profileUrl: URL }]])

describe('PublicProfileAddressService.resolve', () => {
  it('returns the canonical address of a published profile', async () => {
    const { service } = build(addressed())
    expect(await service.resolve(published, DAY)).toEqual({
      status: 'live',
      url: URL,
    })
  })

  it('is not live, without any further read, when the user has no profile', async () => {
    const { service, isRemoved, resolveIdentities } = build(addressed())
    expect(await service.resolve(null, DAY)).toEqual({ status: 'not-live' })
    expect(isRemoved).not.toHaveBeenCalled()
    expect(resolveIdentities).not.toHaveBeenCalled()
  })

  it('is not live while the profile is unpublished', async () => {
    const { service } = build(addressed())
    expect(
      await service.resolve({ ...published, publishedAt: null }, DAY),
    ).toEqual({ status: 'not-live' })
  })

  it('is not live once the profile is deleted, even if it was published', async () => {
    const { service } = build(addressed())
    expect(
      await service.resolve(
        { ...published, deletedAt: new Date('2026-10-10T00:00:00Z') },
        DAY,
      ),
    ).toEqual({ status: 'not-live' })
  })

  it('is removed, never live, while a removal is on record for a published profile', async () => {
    const { service, resolveIdentities } = build(addressed(), true)
    expect(await service.resolve(published, DAY)).toEqual({
      status: 'removed',
    })
    expect(resolveIdentities).not.toHaveBeenCalled()
  })

  it('is unknown, never not-live, when election-api does not answer', async () => {
    const { service } = build(new Map())
    expect(await service.resolve(published, DAY)).toEqual({
      status: 'unknown',
    })
  })

  it('is unknown when the person has no slug to address the page by', async () => {
    const { service } = build(
      new Map([[PERSON_ID, { fullName: 'Renee Diaz', profileUrl: null }]]),
    )
    expect(await service.resolve(published, DAY)).toEqual({
      status: 'unknown',
    })
  })

  it('asks election-api once per person per day for an answer it gave', async () => {
    const { service, resolveIdentities } = build(addressed())
    await service.resolve(published, DAY)
    await service.resolve(published, DAY)
    expect(resolveIdentities).toHaveBeenCalledTimes(1)
    await service.resolve(published, '2026-10-16')
    expect(resolveIdentities).toHaveBeenCalledTimes(2)
  })

  it('keeps a no-slug answer for the day, but asks again after an unanswered call', async () => {
    const noSlug = build(
      new Map([[PERSON_ID, { fullName: 'Renee Diaz', profileUrl: null }]]),
    )
    await noSlug.service.resolve(published, DAY)
    await noSlug.service.resolve(published, DAY)
    expect(noSlug.resolveIdentities).toHaveBeenCalledTimes(1)

    const outage = build(new Map())
    await outage.service.resolve(published, DAY)
    await outage.service.resolve(published, DAY)
    expect(outage.resolveIdentities).toHaveBeenCalledTimes(2)
  })

  it('re-reads the removal state every call, even with a cached address', async () => {
    const { service, isRemoved } = build(addressed())
    await service.resolve(published, DAY)
    isRemoved.mockResolvedValueOnce(true)
    expect(await service.resolve(published, DAY)).toEqual({
      status: 'removed',
    })
  })
})

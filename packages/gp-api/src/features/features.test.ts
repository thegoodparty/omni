import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UnauthorizedException } from '@nestjs/common'

const { mockFetchV2 } = vi.hoisted(() => ({ mockFetchV2: vi.fn() }))

vi.mock('@amplitude/experiment-node-server', () => ({
  Experiment: { initializeRemote: () => ({ fetchV2: mockFetchV2 }) },
}))

import { FeaturesController } from './features.controller'
import { FeaturesService } from './services/features.service'
import { UsersService } from '../users/services/users.service'
import { PinoLogger } from 'nestjs-pino'
import { Organization, User } from '../generated/prisma'

const makeService = (): FeaturesService =>
  new FeaturesService(
    {} as Partial<UsersService> as UsersService,
    {
      setContext: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as Partial<PinoLogger> as PinoLogger,
  )

const asUser = (u: Partial<User>): User => u as Partial<User> as User

const asOrganization = (o: Partial<Organization>): Organization =>
  o as Partial<Organization> as Organization

// The module captures the key at import time, and .env.test carries the
// placeholder — which short-circuits before any network call. Re-import
// under a real key to exercise the fetch paths.
const loadRealKeyService = async (
  users: Partial<UsersService> = {},
): Promise<FeaturesService> => {
  vi.stubEnv('AMPLITUDE_PROJECT_API_KEY', 'real-prod-key')
  vi.resetModules()
  const { FeaturesService: FS } = await import('./services/features.service.js')
  vi.unstubAllEnvs()
  vi.resetModules()
  return new FS(
    users as UsersService,
    {
      setContext: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as Partial<PinoLogger> as PinoLogger,
  )
}

describe('FeaturesController', () => {
  it('rejects a caller with no user (e.g. M2M token) instead of NPE-ing', async () => {
    const features = {
      getAllVariants: vi.fn(),
    } as Partial<FeaturesService> as FeaturesService
    const controller = new FeaturesController(features)

    await expect(controller.getVariants(undefined, undefined)).rejects.toThrow(
      UnauthorizedException,
    )
    expect(features.getAllVariants).not.toHaveBeenCalled()
  })
})

describe('FeaturesService.getAllVariants', () => {
  beforeEach(() => {
    mockFetchV2.mockReset()
  })

  it('falls back to the variant key when value is absent', async () => {
    mockFetchV2.mockResolvedValue({ 'campaign-story': { key: 'on' } })

    const svc = await loadRealKeyService()
    const result = await svc.getAllVariants(asUser({ id: 1, email: 'a@b.com' }))

    expect(result['campaign-story']).toEqual({ value: 'on', key: 'on' })
  })

  it('keeps the value when present', async () => {
    mockFetchV2.mockResolvedValue({
      flag: { key: 'treatment', value: 'treatment' },
    })

    const svc = await loadRealKeyService()
    const result = await svc.getAllVariants(asUser({ id: 1, email: 'a@b.com' }))

    expect(result.flag).toEqual({ value: 'treatment', key: 'treatment' })
  })

  it('sends trimmed name and omits empty phone/zip', async () => {
    mockFetchV2.mockResolvedValue({})

    const svc = await loadRealKeyService()
    await svc.getAllVariants(
      asUser({
        id: 7,
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: '',
        phone: null,
        zip: null,
      }),
    )

    expect(mockFetchV2).toHaveBeenCalledWith({
      user_id: '7',
      user_properties: { email: 'jane@example.com', name: 'Jane' },
    })
  })

  it('includes phone and zip when present', async () => {
    mockFetchV2.mockResolvedValue({})

    const svc = await loadRealKeyService()
    await svc.getAllVariants(
      asUser({
        id: 8,
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        phone: '555',
        zip: '90210',
      }),
    )

    expect(mockFetchV2).toHaveBeenCalledWith({
      user_id: '8',
      user_properties: {
        email: 'a@b.com',
        name: 'A B',
        phone: '555',
        zip: '90210',
      },
    })
  })

  // Unlike isFeatureEnabled (which fails closed/open by key type), getAllVariants
  // always degrades to an empty map so the seed endpoint never 500s.
  it('returns empty variants when Amplitude fails', async () => {
    const svc = await loadRealKeyService()
    mockFetchV2.mockRejectedValue(new Error('status=401'))

    const result = await svc.getAllVariants(asUser({ id: 1, email: 'a@b.com' }))

    expect(result).toEqual({})
  })

  it('short-circuits to empty variants under the placeholder key without fetching', async () => {
    const result = await makeService().getAllVariants(
      asUser({ id: 1, email: 'a@b.com' }),
    )

    expect(result).toEqual({})
    expect(mockFetchV2).not.toHaveBeenCalled()
  })

  // issue-capture rolls out by org: whoever asks inside one gets what its
  // owner gets, so a volunteer and their candidate land on the same side.
  describe('in an organization', () => {
    const owner = asUser({ id: 10, email: 'owner@b.com' })
    const volunteer = asUser({ id: 20, email: 'volunteer@b.com' })
    const organization = asOrganization({ slug: 'campaign-x', ownerId: 10 })
    const findOwner = vi.fn()

    const ownerVariants = {
      'issue-capture': { key: 'on', value: 'on' },
      'campaign-story': { key: 'off', value: 'off' },
    }
    const volunteerVariants = {
      'issue-capture': { key: 'off', value: 'off' },
      'campaign-story': { key: 'on', value: 'on' },
    }

    beforeEach(() => {
      findOwner.mockReset().mockResolvedValue(owner)
    })

    it('reads issue-capture from the owner and every other flag from the user', async () => {
      mockFetchV2.mockImplementation(async (experimentUser) =>
        experimentUser.user_id === '10' ? ownerVariants : volunteerVariants,
      )

      const svc = await loadRealKeyService({ findUniqueOrThrow: findOwner })
      const result = await svc.getAllVariants(volunteer, organization)

      expect(result).toEqual({
        'issue-capture': { key: 'on', value: 'on' },
        'campaign-story': { key: 'on', value: 'on' },
      })
      expect(findOwner).toHaveBeenCalledWith({ where: { id: 10 } })
    })

    it("leaves issue-capture off when the owner's evaluation fails", async () => {
      mockFetchV2.mockImplementation(async (experimentUser) => {
        if (experimentUser.user_id === '10') throw new Error('status=503')
        return { 'issue-capture': { key: 'on', value: 'on' } }
      })

      const svc = await loadRealKeyService({ findUniqueOrThrow: findOwner })
      const result = await svc.getAllVariants(volunteer, organization)

      expect(result).toEqual({})
    })

    it('leaves issue-capture off when the owner cannot be read', async () => {
      findOwner.mockRejectedValue(new Error('No User found'))
      mockFetchV2.mockResolvedValue(volunteerVariants)

      const svc = await loadRealKeyService({ findUniqueOrThrow: findOwner })
      const result = await svc.getAllVariants(volunteer, organization)

      expect(result).toEqual({
        'campaign-story': { key: 'on', value: 'on' },
      })
      expect(mockFetchV2).toHaveBeenCalledTimes(1)
    })

    it('evaluates the owner once when the owner is the one asking', async () => {
      mockFetchV2.mockResolvedValue(ownerVariants)

      const svc = await loadRealKeyService({ findUniqueOrThrow: findOwner })
      const result = await svc.getAllVariants(owner, organization)

      expect(result['issue-capture']).toEqual({ key: 'on', value: 'on' })
      expect(mockFetchV2).toHaveBeenCalledTimes(1)
      expect(findOwner).not.toHaveBeenCalled()
    })
  })
})

describe('FeaturesService.isFeatureEnabled', () => {
  beforeEach(() => {
    mockFetchV2.mockReset()
  })

  it('returns true when the variant resolves to "on"', async () => {
    const svc = await loadRealKeyService()
    mockFetchV2.mockResolvedValue({ flag: { value: 'on', key: 'on' } })

    const result = await svc.isFeatureEnabled({
      user: asUser({ id: 1, email: 'a@b.com' }),
      feature: 'flag',
    })

    expect(result).toBe(true)
  })

  it('returns false when the variant is absent or not "on"', async () => {
    const svc = await loadRealKeyService()
    mockFetchV2.mockResolvedValue({ flag: { value: 'off', key: 'off' } })

    const result = await svc.isFeatureEnabled({
      user: asUser({ id: 1, email: 'a@b.com' }),
      feature: 'flag',
    })

    expect(result).toBe(false)
  })

  // .env.test uses the `some_key` placeholder: the local-box default is ON
  // and the doomed Amplitude round-trip (it can only 401) is skipped
  // entirely — its retry latency pushed CI tests over their timeouts.
  it('short-circuits to on under the placeholder key without fetching', async () => {
    const result = await makeService().isFeatureEnabled({
      user: asUser({ id: 1, email: 'a@b.com' }),
      feature: 'flag',
    })

    expect(result).toBe(true)
    expect(mockFetchV2).not.toHaveBeenCalled()
  })

  // .env.test pins the placeholder key, so the prod fail-closed branch can't be
  // reached without re-importing the module under a real key.
  it('fails closed (returns false) when Amplitude fails with a real key', async () => {
    vi.stubEnv('AMPLITUDE_PROJECT_API_KEY', 'real-prod-key')
    vi.resetModules()
    mockFetchV2.mockRejectedValue(new Error('status=401'))

    const { FeaturesService: FS } =
      await import('./services/features.service.js')
    const svc = new FS(
      {} as Partial<UsersService> as UsersService,
      {
        setContext: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      } as Partial<PinoLogger> as PinoLogger,
    )

    const result = await svc.isFeatureEnabled({
      user: asUser({ id: 1, email: 'a@b.com' }),
      feature: 'flag',
    })

    expect(result).toBe(false)
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})

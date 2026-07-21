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
import { User } from '../generated/prisma'

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

// The module captures the key at import time, and .env.test carries the
// placeholder — which short-circuits before any network call. Re-import
// under a real key to exercise the fetch paths.
const loadRealKeyService = async (): Promise<FeaturesService> => {
  vi.stubEnv('AMPLITUDE_PROJECT_API_KEY', 'real-prod-key')
  vi.resetModules()
  const { FeaturesService: FS } = await import('./services/features.service.js')
  vi.unstubAllEnvs()
  vi.resetModules()
  return new FS(
    {} as Partial<UsersService> as UsersService,
    {
      setContext: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as Partial<PinoLogger> as PinoLogger,
  )
}

describe('FeaturesController', () => {
  it('wraps the resolved variant map for the current user', async () => {
    const variants = { 'campaign-story': { value: 'on', key: 'on' } }
    const features = {
      getAllVariants: vi.fn().mockResolvedValue(variants),
    } as Partial<FeaturesService> as FeaturesService
    const controller = new FeaturesController(features)
    const user = asUser({ id: 42 })

    await expect(controller.getVariants(user)).resolves.toEqual({ variants })
    expect(features.getAllVariants).toHaveBeenCalledWith(user)
  })

  it('rejects a caller with no user (e.g. M2M token) instead of NPE-ing', async () => {
    const features = {
      getAllVariants: vi.fn(),
    } as Partial<FeaturesService> as FeaturesService
    const controller = new FeaturesController(features)

    await expect(controller.getVariants(undefined)).rejects.toThrow(
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

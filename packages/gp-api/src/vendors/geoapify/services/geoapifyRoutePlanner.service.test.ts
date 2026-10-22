import { BadGatewayException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

// VENDOR_MODE is a module-level export evaluated at import time. Use a
// mutable value + getter so it stays controllable per-test.
const { mockMode } = vi.hoisted(() => ({
  mockMode: { value: 'mock' as 'mock' | 'live' },
}))
vi.mock('src/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('src/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get VENDOR_MODE() {
      return mockMode.value
    },
  }
})

import {
  GEOAPIFY_MOCK_API_KEY,
  GeoapifyRoutePlannerService,
} from './geoapifyRoutePlanner.service'

const apiKeyOf = (service: GeoapifyRoutePlannerService): string =>
  (service as unknown as { apiKey: () => string }).apiKey()

describe('GeoapifyRoutePlannerService api key', () => {
  let service: GeoapifyRoutePlannerService

  beforeEach(() => {
    service = new GeoapifyRoutePlannerService(createMockLogger())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('mock mode', () => {
    beforeEach(() => {
      mockMode.value = 'mock'
    })

    it('sends the mock key when GEOAPIFY_API_KEY is unset', () => {
      vi.stubEnv('GEOAPIFY_API_KEY', '')
      expect(apiKeyOf(service)).toBe(GEOAPIFY_MOCK_API_KEY)
    })

    it('still sends the mock key when GEOAPIFY_API_KEY is set', () => {
      vi.stubEnv('GEOAPIFY_API_KEY', 'real-key')
      expect(apiKeyOf(service)).toBe(GEOAPIFY_MOCK_API_KEY)
    })
  })

  describe('live mode', () => {
    beforeEach(() => {
      mockMode.value = 'live'
    })

    it('throws when GEOAPIFY_API_KEY is unset', () => {
      vi.stubEnv('GEOAPIFY_API_KEY', '')
      expect(() => apiKeyOf(service)).toThrow(BadGatewayException)
    })

    it('returns the real key when set', () => {
      vi.stubEnv('GEOAPIFY_API_KEY', 'real-key')
      expect(apiKeyOf(service)).toBe('real-key')
    })
  })
})

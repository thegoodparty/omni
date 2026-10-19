import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

// VENDOR_MODE and vendorBaseUrl are module-level exports evaluated at import
// time. Use a mutable value + getters so they stay controllable per-test,
// following the same pattern as geoapifyMock.routes.test.ts.
const { mockMode } = vi.hoisted(() => ({
  mockMode: { value: 'mock' as 'mock' | 'live' },
}))
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get VENDOR_MODE() {
      return mockMode.value
    },
    // Override so baseUrl resolution also respects the mutable mockMode.
    vendorBaseUrl: (vendor: string, liveUrl: string) =>
      mockMode.value !== 'mock'
        ? liveUrl
        : `http://localhost:3000/v1/vendor-mocks/${vendor}`,
  }
})

import { CallhubBaseConfig } from './callhubBaseConfig'

describe('CallhubBaseConfig', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  describe('mock mode', () => {
    it('routes baseUrl to the in-process vendor-mock path', () => {
      const config = new CallhubBaseConfig(createMockLogger())
      expect(config.baseUrl).toMatch(/\/v1\/vendor-mocks\/callhub$/)
    })

    it('returns mock-key without needing CALLHUB_API_KEY', () => {
      const config = new CallhubBaseConfig(createMockLogger())
      expect(config.apiKey).toBe('mock-key')
    })
  })

  describe('live mode', () => {
    beforeEach(() => {
      mockMode.value = 'live'
    })

    it('keeps baseUrl as the real CallHub API base URL', () => {
      const config = new CallhubBaseConfig(createMockLogger())
      expect(config.baseUrl).toBe('https://api-na1.callhub.io')
    })

    it('returns the API key when CALLHUB_API_KEY is set', () => {
      // .env.test sets CALLHUB_API_KEY=test-callhub-key
      const config = new CallhubBaseConfig(createMockLogger())
      expect(config.apiKey).toBe('test-callhub-key')
    })
  })

  describe('live mode — missing key', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    it('throws when CALLHUB_API_KEY is absent', async () => {
      mockMode.value = 'live'
      vi.stubEnv('CALLHUB_API_KEY', '')
      vi.resetModules()
      // Fresh import captures the empty CALLHUB_API_KEY from process.env.
      const { CallhubBaseConfig: FreshConfig } =
        await import('./callhubBaseConfig.js')
      const config = new FreshConfig(createMockLogger())
      expect(() => config.apiKey).toThrow('Missing CALLHUB_API_KEY config')
    })
  })
})

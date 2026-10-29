import { afterEach, describe, expect, it, vi } from 'vitest'
import { appEnvOverrides } from '@/shared/test-utils/appEnvOverrides'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallhubBaseConfig } from './callhubBaseConfig'

describe('CallhubBaseConfig', () => {
  describe('mock mode', () => {
    it('routes baseUrl to the in-process vendor-mock path', () => {
      const config = new CallhubBaseConfig(createMockLogger())
      expect(config.baseUrl).toMatch(/\/v1\/vendor-mocks\/callhub$/)
    })

    it('returns mock-key without needing CALLHUB_API_KEY', () => {
      appEnvOverrides.VENDOR_MODE = 'mock'
      const config = new CallhubBaseConfig(createMockLogger())
      expect(config.apiKey).toBe('mock-key')
    })
  })

  describe('live mode', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('returns the API key when CALLHUB_API_KEY is set', () => {
      appEnvOverrides.VENDOR_MODE = 'live'
      // .env.test sets CALLHUB_API_KEY=test-callhub-key
      const config = new CallhubBaseConfig(createMockLogger())
      expect(config.apiKey).toBe('test-callhub-key')
    })

    it('throws when CALLHUB_API_KEY is absent', () => {
      appEnvOverrides.VENDOR_MODE = 'live'
      vi.stubEnv('CALLHUB_API_KEY', '')
      const config = new CallhubBaseConfig(createMockLogger())
      expect(() => config.apiKey).toThrow('Missing CALLHUB_API_KEY config')
    })
  })
})

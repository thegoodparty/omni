import { BadRequestException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

// VENDOR_MODE and vendorBaseUrl are module-level values evaluated at import
// time. Use a mutable value + getters so they stay controllable per-test,
// following the same pattern as callhubBaseConfig.test.ts.
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
    vendorBaseUrl: (vendor: string, liveUrl: string) =>
      mockMode.value !== 'mock'
        ? liveUrl
        : `http://localhost:3000/v1/vendor-mocks/${vendor}`,
  }
})

// The config is captured at module load, so each case that needs different
// env stubs uses vi.resetModules() + a fresh dynamic import.
const loadFreshConfig = async () => {
  vi.resetModules()
  const { PeerlyBaseConfig } = await import('./peerlyBaseConfig.js')
  return new PeerlyBaseConfig(createMockLogger())
}

describe('PeerlyBaseConfig — credentials absent', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  const blankCreds = () => {
    vi.stubEnv('PEERLY_API_BASE_URL', '')
    vi.stubEnv('PEERLY_MD5_EMAIL', '')
    vi.stubEnv('PEERLY_MD5_PASSWORD', '')
    vi.stubEnv('PEERLY_ACCOUNT_NUMBER', '')
  }

  describe('mock mode', () => {
    beforeEach(() => {
      mockMode.value = 'mock'
    })

    it('returns mock config so services boot credential-free', async () => {
      blankCreds()
      const config = await loadFreshConfig()
      expect(config.baseUrl).toMatch(/\/v1\/vendor-mocks\/peerly$/)
      expect(config.email).toBe('mock@peerly.mock')
      expect(config.password).toBe('mock-password')
      expect(config.accountNumber).toBe('mock-account')
    })

    it('does not log the disabled warning in mock mode', async () => {
      blankCreds()
      vi.resetModules()
      const { PeerlyBaseConfig } = await import('./peerlyBaseConfig.js')
      const logger = createMockLogger()
      new PeerlyBaseConfig(logger)
      expect(logger.warn).not.toHaveBeenCalled()
    })
  })

  describe('live mode', () => {
    beforeEach(() => {
      mockMode.value = 'live'
    })

    it('logs once across every subclass instance and every getter throws', async () => {
      blankCreds()
      vi.resetModules()
      const { PeerlyBaseConfig } = await import('./peerlyBaseConfig.js')
      const loggerOne = createMockLogger()
      const loggerTwo = createMockLogger()
      new PeerlyBaseConfig(loggerOne)
      new PeerlyBaseConfig(loggerTwo)
      expect(loggerOne.warn).toHaveBeenCalledWith(
        expect.stringContaining('Peerly texting is disabled'),
      )
      expect(loggerTwo.warn).not.toHaveBeenCalled()

      const config = new PeerlyBaseConfig(createMockLogger())
      expect(() => config.baseUrl).toThrow(BadRequestException)
      expect(() => config.email).toThrow(BadRequestException)
      expect(() => config.password).toThrow(BadRequestException)
      expect(() => config.accountNumber).toThrow(BadRequestException)
    })
  })
})

describe('PeerlyBaseConfig — credentials configured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  const setCreds = () => {
    vi.stubEnv('PEERLY_API_BASE_URL', 'https://app.peerly.com/api')
    vi.stubEnv('PEERLY_MD5_EMAIL', 'MD5(email@domain.io)')
    vi.stubEnv('PEERLY_MD5_PASSWORD', 'MD5(password)')
    vi.stubEnv('PEERLY_ACCOUNT_NUMBER', '12345678')
  }

  describe('mock mode', () => {
    beforeEach(() => {
      mockMode.value = 'mock'
    })

    it('routes baseUrl to the in-process vendor-mock path', async () => {
      setCreds()
      const config = await loadFreshConfig()
      expect(config.baseUrl).toMatch(/\/v1\/vendor-mocks\/peerly$/)
    })
  })

  describe('live mode', () => {
    beforeEach(() => {
      mockMode.value = 'live'
    })

    it('returns the real env values', async () => {
      setCreds()
      const config = await loadFreshConfig()
      expect(config.baseUrl).toBe('https://app.peerly.com/api')
      expect(config.email).toBe('MD5(email@domain.io)')
      expect(config.password).toBe('MD5(password)')
      expect(config.accountNumber).toBe('12345678')
    })
  })
})

import { BadRequestException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

// The config is captured at module load, so each case stubs the env and
// re-imports a fresh copy of the module.
const loadConfig = async () => {
  vi.resetModules()
  const { PeerlyBaseConfig } = await import('./peerlyBaseConfig.js')
  return new PeerlyBaseConfig(createMockLogger())
}

describe('PeerlyBaseConfig when not configured', () => {
  beforeEach(() => {
    vi.stubEnv('VENDOR_MODE', 'live')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('logs once across every subclass instance and every getter throws', async () => {
    vi.stubEnv('PEERLY_API_BASE_URL', '')
    vi.stubEnv('PEERLY_MD5_EMAIL', '')
    vi.stubEnv('PEERLY_MD5_PASSWORD', '')
    vi.stubEnv('PEERLY_ACCOUNT_NUMBER', '')
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

describe('PeerlyBaseConfig when configured', () => {
  beforeEach(() => {
    vi.stubEnv('VENDOR_MODE', 'live')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns the real values', async () => {
    vi.stubEnv('PEERLY_API_BASE_URL', 'https://app.peerly.com/api')
    vi.stubEnv('PEERLY_MD5_EMAIL', 'MD5(email@domain.io)')
    vi.stubEnv('PEERLY_MD5_PASSWORD', 'MD5(password)')
    vi.stubEnv('PEERLY_ACCOUNT_NUMBER', '12345678')
    const config = await loadConfig()

    expect(config.baseUrl).toBe('https://app.peerly.com/api')
    expect(config.email).toBe('MD5(email@domain.io)')
    expect(config.password).toBe('MD5(password)')
    expect(config.accountNumber).toBe('12345678')
  })
})

describe('PeerlyBaseConfig in mock mode', () => {
  beforeEach(() => {
    vi.stubEnv('VENDOR_MODE', 'mock')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('is configured with the mock base URL when no Peerly env is set', async () => {
    vi.stubEnv('PEERLY_API_BASE_URL', '')
    vi.stubEnv('PEERLY_MD5_EMAIL', '')
    vi.stubEnv('PEERLY_MD5_PASSWORD', '')
    vi.stubEnv('PEERLY_ACCOUNT_NUMBER', '')
    const config = await loadConfig()

    expect(config.baseUrl).toMatch(/\/v1\/vendor-mocks\/peerly$/)
    expect(config.email).toBe('mock-peerly-email')
    expect(config.password).toBe('mock-peerly-password')
    expect(config.accountNumber).toBe('mock-peerly')
  })

  it('routes to the mock but keeps credentials that are set', async () => {
    vi.stubEnv('PEERLY_API_BASE_URL', 'https://app.peerly.com/api')
    vi.stubEnv('PEERLY_MD5_EMAIL', 'MD5(email@domain.io)')
    vi.stubEnv('PEERLY_MD5_PASSWORD', 'MD5(password)')
    vi.stubEnv('PEERLY_ACCOUNT_NUMBER', '12345678')
    const config = await loadConfig()

    expect(config.baseUrl).toMatch(/\/v1\/vendor-mocks\/peerly$/)
    expect(config.email).toBe('MD5(email@domain.io)')
    expect(config.accountNumber).toBe('12345678')
  })
})

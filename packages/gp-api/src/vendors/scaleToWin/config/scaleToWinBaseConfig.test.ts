import { afterEach, describe, expect, it, vi } from 'vitest'
import { appEnvOverrides } from '@/shared/test-utils/appEnvOverrides'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ScaleToWinBaseConfig } from './scaleToWinBaseConfig'

describe('ScaleToWinBaseConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('routes baseUrl to the in-process vendor mock in mock mode', () => {
    const config = new ScaleToWinBaseConfig(createMockLogger())
    expect(config.baseUrl).toMatch(/\/v1\/vendor-mocks\/scaleToWin$/)
  })

  it('uses the mock credentials in mock mode without any key set', () => {
    appEnvOverrides.VENDOR_MODE = 'mock'
    vi.stubEnv('S2W_API_KEY_ID', '')
    vi.stubEnv('S2W_API_KEY_SECRET', '')
    vi.stubEnv('S2W_SUBACCOUNT_ID', '')
    const config = new ScaleToWinBaseConfig(createMockLogger())
    expect(config.credentials).toEqual({
      username: 'mock-key-id',
      password: 'mock-key-secret',
    })
    expect(config.subaccountId).toBe('mock-subaccount')
  })

  it('reads the keys in live mode', () => {
    appEnvOverrides.VENDOR_MODE = 'live'
    vi.stubEnv('S2W_API_KEY_ID', 'key-id')
    vi.stubEnv('S2W_API_KEY_SECRET', 'key-secret')
    vi.stubEnv('S2W_SUBACCOUNT_ID', 'sub-1')
    const config = new ScaleToWinBaseConfig(createMockLogger())
    expect(config.credentials).toEqual({
      username: 'key-id',
      password: 'key-secret',
    })
    expect(config.subaccountId).toBe('sub-1')
  })

  it('constructs without keys and throws only on first use in live mode', () => {
    appEnvOverrides.VENDOR_MODE = 'live'
    vi.stubEnv('S2W_API_KEY_ID', '')
    vi.stubEnv('S2W_API_KEY_SECRET', '')
    vi.stubEnv('S2W_SUBACCOUNT_ID', '')
    const config = new ScaleToWinBaseConfig(createMockLogger())
    expect(() => config.credentials).toThrow(
      'Missing S2W_API_KEY_ID or S2W_API_KEY_SECRET config',
    )
    expect(() => config.subaccountId).toThrow(
      'Missing S2W_SUBACCOUNT_ID config',
    )
  })
})

import { BadRequestException } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('getPeerlyJobUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('throws when Peerly is not configured', async () => {
    vi.stubEnv('PEERLY_API_BASE_URL', '')
    vi.stubEnv('PEERLY_ACCOUNT_NUMBER', '')
    vi.resetModules()
    const { getPeerlyJobUrl } = await import('./peerlyJobUrl.util.js')

    expect(() => getPeerlyJobUrl('job-123')).toThrow(BadRequestException)
  })

  it('builds the web URL from the configured API base and account number', async () => {
    vi.stubEnv('PEERLY_API_BASE_URL', 'https://app.peerly.com/api')
    vi.stubEnv('PEERLY_ACCOUNT_NUMBER', '12345678')
    vi.resetModules()
    const { getPeerlyJobUrl } = await import('./peerlyJobUrl.util.js')

    expect(getPeerlyJobUrl('job-123')).toBe(
      'https://app.peerly.com/12345678/p2p/job-123',
    )
  })
})

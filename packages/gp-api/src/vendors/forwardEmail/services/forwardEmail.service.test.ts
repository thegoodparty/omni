import { BadRequestException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

// The config is captured at module load, so each case stubs the env and
// re-imports a fresh copy of the module.
const loadService = async (httpService: HttpService) => {
  vi.resetModules()
  const { ForwardEmailService } = await import('./forwardEmail.service.js')
  const logger = createMockLogger()
  return { service: new ForwardEmailService(httpService, logger), logger }
}

describe('ForwardEmailService when not configured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('logs once on construction and every public method throws', async () => {
    vi.stubEnv('FORWARDEMAIL_API_TOKEN', '')
    vi.stubEnv('FORWARDEMAIL_BASE_URL', '')
    const mockGet = vi.fn()
    const { service, logger } = await loadService({
      get: mockGet,
    } as Partial<HttpService> as HttpService)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Campaign email forwarding is disabled'),
    )
    await expect(service.getDomain('example.com')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(mockGet).not.toHaveBeenCalled()
  })
})

describe('ForwardEmailService when configured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('calls the real Forward Email API', async () => {
    vi.stubEnv('FORWARDEMAIL_API_TOKEN', 'real-token')
    vi.stubEnv('FORWARDEMAIL_BASE_URL', 'https://api.forwardemail.net/v1')
    const mockGet = vi.fn().mockReturnValue(
      of({
        data: [{ id: 'domain-1', name: 'example.com' }],
        headers: {},
      }),
    )
    const { service } = await loadService({
      get: mockGet,
    } as Partial<HttpService> as HttpService)

    const result = await service.getDomain('example.com')

    expect(result).toEqual({ id: 'domain-1', name: 'example.com' })
    expect(mockGet).toHaveBeenCalledWith(
      'https://api.forwardemail.net/v1/domains',
      expect.objectContaining({
        headers: { Authorization: expect.stringContaining('Basic ') },
      }),
    )
  })
})

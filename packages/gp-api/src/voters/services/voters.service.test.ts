import { BadRequestException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { SlackService } from 'src/vendors/slack/services/slack.service'

const noopSlack = {
  errorMessage: vi.fn(),
} as Partial<SlackService> as SlackService

const loadService = async (httpService: HttpService) => {
  vi.resetModules()
  const { VotersService } = await import('./voters.service.js')
  const logger = createMockLogger()
  return {
    service: new VotersService(httpService, noopSlack, logger),
    logger,
  }
}

describe('VotersService when not configured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('logs once on construction and every public method throws', async () => {
    vi.stubEnv('L2_DATA_KEY', '')
    const mockGet = vi.fn()
    const { service, logger } = await loadService({
      get: mockGet,
    } as Partial<HttpService> as HttpService)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Voter file lookups are disabled'),
    )
    await expect(service.getColumns('IL')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(mockGet).not.toHaveBeenCalled()
  })
})

describe('VotersService when configured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('calls the real L2 API', async () => {
    vi.stubEnv('L2_DATA_KEY', 'real-key')
    const mockGet = vi.fn().mockReturnValue(of({ data: { columns: [] } }))
    const { service } = await loadService({
      get: mockGet,
    } as Partial<HttpService> as HttpService)

    const result = await service.getColumns('IL')

    expect(result).toEqual([])
    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining('apikey=real-key'),
    )
  })
})

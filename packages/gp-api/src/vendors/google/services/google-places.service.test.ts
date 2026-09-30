import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

const loadService = async (httpService: HttpService) => {
  vi.resetModules()
  const { GooglePlacesService } = await import('./google-places.service.js')
  const logger = createMockLogger()
  return { service: new GooglePlacesService(httpService, logger), logger }
}

describe('GooglePlacesService when not configured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('logs once on construction and throws without calling Google', async () => {
    vi.stubEnv('GOOGLE_API_KEY', '')
    const mockGet = vi.fn()
    const { service, logger } = await loadService({
      get: mockGet,
    } as Partial<HttpService> as HttpService)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Google services are disabled'),
    )
    await expect(
      service.getAddressByPlaceId('place-id'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(mockGet).not.toHaveBeenCalled()
  })
})

describe('GooglePlacesService when configured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('calls the real Google Places API', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'real-key')
    const mockGet = vi.fn().mockReturnValue(
      of({
        data: { status: 'OK', result: { formatted_address: '1 Main St' } },
      }),
    )
    const { service } = await loadService({
      get: mockGet,
    } as Partial<HttpService> as HttpService)

    const result = await service.getAddressByPlaceId('place-id')

    expect(result).toEqual({ formatted_address: '1 Main St' })
    expect(mockGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: { place_id: 'place-id', key: 'real-key' },
      }),
    )
  })

  it('rejects a non-OK status as a gateway failure', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'real-key')
    const mockGet = vi
      .fn()
      .mockReturnValue(of({ data: { status: 'ZERO_RESULTS', result: {} } }))
    const { service } = await loadService({
      get: mockGet,
    } as Partial<HttpService> as HttpService)

    await expect(
      service.getAddressByPlaceId('place-id'),
    ).rejects.toBeInstanceOf(BadGatewayException)
  })
})

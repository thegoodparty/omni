import { BadGatewayException } from '@nestjs/common'
import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { VendorPermanentError } from '@/outreach/vendor/vendorPermanentError'
import { CallfireErrorHandlingService } from './callfireErrorHandling.service'
import { CallfireHttpService } from './callfireHttp.service'
import { CallfireNumbersService } from './callfireNumbers.service'

const createAxiosError = (
  data: Record<string, unknown> | undefined,
  status = 500,
): AxiosError => {
  const config: AxiosRequestConfig = { url: '/x', headers: new AxiosHeaders() }
  const response: AxiosResponse = {
    data,
    status,
    statusText: 'err',
    headers: {},
    config: config as AxiosResponse['config'],
  }
  return new AxiosError(
    'Request failed',
    'ERR_BAD_RESPONSE',
    config as AxiosError['config'],
    {},
    response,
  )
}

describe('CallfireNumbersService', () => {
  let service: CallfireNumbersService
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() }
    service = new CallfireNumbersService(
      createMockLogger(),
      http as unknown as CallfireHttpService,
      new CallfireErrorHandlingService(),
    )
  })

  describe('searchLocalNumbers', () => {
    it('maps params to prefix/state/limit and returns the page items', async () => {
      http.get.mockResolvedValue({
        items: [
          {
            number: '15125550143',
            nationalFormat: '(512) 555-0143',
            tollFree: false,
            region: { state: 'TX', city: 'Austin' },
            // Unmodeled fields CallFire returns are stripped by the schema.
            some_unmodeled_field: 'ignored',
          },
        ],
        limit: 5,
        offset: 0,
        totalCount: 1,
      })

      const result = await service.searchLocalNumbers({
        areaCode: '512',
        state: 'TX',
        count: 5,
      })

      expect(http.get).toHaveBeenCalledWith('/numbers/local', {
        params: { prefix: '512', state: 'TX', limit: 5 },
      })
      expect(result).toHaveLength(1)
      expect(result[0]?.number).toBe('15125550143')
      expect(result[0]?.region?.state).toBe('TX')
      expect(result[0]).not.toHaveProperty('some_unmodeled_field')
    })

    it('defaults the limit and treats a missing items array as empty', async () => {
      http.get.mockResolvedValue({ limit: 20, offset: 0, totalCount: 0 })

      const result = await service.searchLocalNumbers({ areaCode: '512' })

      expect(http.get).toHaveBeenCalledWith('/numbers/local', {
        params: { prefix: '512', state: undefined, limit: 20 },
      })
      expect(result).toEqual([])
    })

    it('maps a transient CallFire failure to a 502', async () => {
      http.get.mockRejectedValue(createAxiosError({ message: 'boom' }, 500))

      await expect(
        service.searchLocalNumbers({ areaCode: '512' }),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })

    it('maps a permanent 4xx failure to a VendorPermanentError', async () => {
      http.get.mockRejectedValue(
        createAxiosError({ message: 'bad prefix' }, 400),
      )

      await expect(
        service.searchLocalNumbers({ areaCode: '512' }),
      ).rejects.toBeInstanceOf(VendorPermanentError)
    })
  })
})

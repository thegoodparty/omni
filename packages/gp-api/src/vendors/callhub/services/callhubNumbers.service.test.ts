import { BadGatewayException } from '@nestjs/common'
import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'
import { CallhubNumbersService } from './callhubNumbers.service'

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

describe('CallhubNumbersService', () => {
  let service: CallhubNumbersService
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() }
    service = new CallhubNumbersService(
      createMockLogger(),
      http as unknown as CallhubHttpService,
      new CallhubErrorHandlingService(),
    )
  })

  describe('rentNumber', () => {
    it('rents a VOICE_BROADCAST number for the requested area code', async () => {
      http.post.mockResolvedValue({
        phone_number: '+15125550143',
        country: 'US',
        region: 'TX',
        is_active: true,
        api_monthly_rental_charge: 1.15,
        // Extra fields CallHub returns are stripped by the schema.
        some_unmodeled_field: 'ignored',
      })

      const result = await service.rentNumber({
        countryIso: 'US',
        areaCodePrefix: '512',
      })

      expect(http.post).toHaveBeenCalledWith('/v1/numbers/rent/', {
        country_iso: 'US',
        phone_number_prefix: '512',
        campaign_type: 'VOICE_BROADCAST',
      })
      expect(result.phone_number).toBe('+15125550143')
      expect(result).not.toHaveProperty('some_unmodeled_field')
    })

    it('maps a CallHub failure to a 502', async () => {
      http.post.mockRejectedValue(
        createAxiosError({ error_message: 'no inventory' }, 400),
      )

      await expect(
        service.rentNumber({ countryIso: 'US', areaCodePrefix: '512' }),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })

    it('retries without the prefix for a national number when CallHub has no inventory for the area code', async () => {
      http.post
        .mockRejectedValueOnce(
          createAxiosError(
            {
              data: {
                error:
                  'We are currently unable to offer your requested numbers',
              },
            },
            400,
          ),
        )
        .mockResolvedValueOnce({
          phone_number: '+12025550147',
          country: 'US',
          region: 'DC',
          is_active: true,
        })

      const result = await service.rentNumber({
        countryIso: 'US',
        areaCodePrefix: '212',
      })

      expect(http.post).toHaveBeenCalledTimes(2)
      expect(http.post).toHaveBeenNthCalledWith(1, '/v1/numbers/rent/', {
        country_iso: 'US',
        phone_number_prefix: '212',
        campaign_type: 'VOICE_BROADCAST',
      })
      expect(http.post).toHaveBeenNthCalledWith(2, '/v1/numbers/rent/', {
        country_iso: 'US',
        phone_number_prefix: undefined,
        campaign_type: 'VOICE_BROADCAST',
      })
      expect(result.phone_number).toBe('+12025550147')
    })

    it('surfaces a 502 when the national retry also fails, retrying only once', async () => {
      http.post
        .mockRejectedValueOnce(
          createAxiosError(
            {
              data: {
                error:
                  'We are currently unable to offer your requested numbers',
              },
            },
            400,
          ),
        )
        .mockRejectedValueOnce(createAxiosError({ detail: 'boom' }, 500))

      await expect(
        service.rentNumber({ countryIso: 'US', areaCodePrefix: '212' }),
      ).rejects.toBeInstanceOf(BadGatewayException)
      expect(http.post).toHaveBeenCalledTimes(2)
    })

    it('does not retry on a different 400 (a genuine bad request)', async () => {
      http.post.mockRejectedValue(
        createAxiosError({ data: { error: 'Invalid country_iso' } }, 400),
      )

      await expect(
        service.rentNumber({ countryIso: 'US', areaCodePrefix: '212' }),
      ).rejects.toBeInstanceOf(BadGatewayException)
      expect(http.post).toHaveBeenCalledTimes(1)
    })

    it('surfaces a national (no-prefix) rental failure without retrying', async () => {
      http.post.mockRejectedValue(
        createAxiosError(
          {
            data: {
              error: 'We are currently unable to offer your requested numbers',
            },
          },
          400,
        ),
      )

      await expect(
        service.rentNumber({ countryIso: 'US' }),
      ).rejects.toBeInstanceOf(BadGatewayException)
      expect(http.post).toHaveBeenCalledTimes(1)
    })
  })

  describe('listRentedNumbers', () => {
    it('returns the results from the paged envelope', async () => {
      http.get.mockResolvedValue({
        count: 1,
        next: null,
        previous: null,
        results: [{ phone_number: '+15125550143', is_active: true }],
      })

      const result = await service.listRentedNumbers()

      expect(http.get).toHaveBeenCalledWith(
        '/v1/numbers/rented_calling_numbers/',
        {
          params: { page_size: 1000 },
        },
      )
      expect(result).toHaveLength(1)
      expect(result[0]?.phone_number).toBe('+15125550143')
    })

    it('maps a CallHub failure to a 502', async () => {
      http.get.mockRejectedValue(createAxiosError({ detail: 'throttled' }, 429))

      await expect(service.listRentedNumbers()).rejects.toBeInstanceOf(
        BadGatewayException,
      )
    })
  })
})

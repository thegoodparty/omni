import { BadGatewayException } from '@nestjs/common'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallhubDncService, dncKey } from './callhubDnc.service'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'

const axiosError = (status: number): AxiosError => {
  const config = { url: '/x', headers: new AxiosHeaders() }
  const response = {
    data: { detail: 'boom' },
    status,
    statusText: 'err',
    headers: {},
    config: config as AxiosResponse['config'],
  } as AxiosResponse
  return new AxiosError(
    'failed',
    'ERR',
    config as AxiosError['config'],
    {},
    response,
  )
}

describe('dncKey', () => {
  it('normalizes assorted formats to a 10-digit US key', () => {
    expect(dncKey('+18557492163')).toBe('8557492163')
    expect(dncKey('855-749-2163')).toBe('8557492163')
    expect(dncKey('18557492163')).toBe('8557492163')
    expect(dncKey('(855) 749 2163')).toBe('8557492163')
  })
})

describe('CallhubDncService', () => {
  let service: CallhubDncService
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() }
    service = new CallhubDncService(
      createMockLogger(),
      http as unknown as CallhubHttpService,
      new CallhubErrorHandlingService(),
    )
  })

  it('pages through the DNC list following next (path-only)', async () => {
    http.get
      .mockResolvedValueOnce({
        count: 2,
        next: 'https://api-na1.callhub.io/v1/dnc_contacts/?page=2',
        previous: null,
        results: [{ phone_number: '855-749-2163' }],
      })
      .mockResolvedValueOnce({
        count: 2,
        next: null,
        previous: null,
        results: [{ phone_number: '+15125550143' }],
      })

    const keys = await service.loadDncKeys()

    expect(keys.has('8557492163')).toBe(true)
    expect(keys.has('5125550143')).toBe(true)
    // The second page is fetched by path, not the absolute URL.
    expect(http.get).toHaveBeenNthCalledWith(2, '/v1/dnc_contacts/?page=2')
  })

  it('partitions an audience into dialable vs. suppressed', async () => {
    http.get.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [{ phone_number: '8557492163' }],
    })

    const result = await service.partitionByDnc([
      '+18557492163', // on the DNC list (different format)
      '5125550143', // dialable
    ])

    expect(result.suppressed).toEqual(['+18557492163'])
    expect(result.dialable).toEqual(['5125550143'])
  })

  it('maps a CallHub failure to a 502', async () => {
    http.get.mockRejectedValue(axiosError(500))

    await expect(service.loadDncKeys()).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })
})

import { BadGatewayException } from '@nestjs/common'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallfireDncService, dncKey } from './callfireDnc.service'
import { CallfireErrorHandlingService } from './callfireErrorHandling.service'
import { CallfireHttpService } from './callfireHttp.service'

const axiosError = (status: number): AxiosError => {
  const config = { url: '/x', headers: new AxiosHeaders() }
  const response = {
    data: { message: 'boom' },
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

describe('CallfireDncService', () => {
  let service: CallfireDncService
  let http: { get: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn() }
    service = new CallfireDncService(
      createMockLogger(),
      http as unknown as CallfireHttpService,
      new CallfireErrorHandlingService(),
    )
  })

  it('pages the DNC list by limit/offset, filtering call=true', async () => {
    http.get
      .mockResolvedValueOnce({
        limit: 1,
        offset: 0,
        totalCount: 2,
        items: [{ number: '18557492163', call: true }],
      })
      .mockResolvedValueOnce({
        limit: 1,
        offset: 1,
        totalCount: 2,
        items: [{ number: '15125550143', call: true }],
      })
      .mockResolvedValueOnce({
        limit: 1,
        offset: 2,
        totalCount: 2,
        items: [],
      })

    const keys = await service.loadDncKeys()

    expect(keys.has('8557492163')).toBe(true)
    expect(keys.has('5125550143')).toBe(true)
    expect(http.get).toHaveBeenNthCalledWith(
      1,
      '/contacts/dncs?call=true&limit=1000&offset=0',
    )
  })

  it('partitions an audience into callable vs. DNC-suppressed', async () => {
    http.get.mockResolvedValue({
      limit: 1000,
      offset: 0,
      totalCount: 1,
      items: [{ number: '18557492163', call: true }],
    })

    const result = await service.partitionByDnc([
      '+18557492163', // on the DNC list (different format)
      '5125550143', // callable
    ])

    expect(result.dnc).toEqual(['+18557492163'])
    expect(result.callable).toEqual(['5125550143'])
  })

  it('maps a CallFire DNC failure to a 502', async () => {
    http.get.mockRejectedValue(axiosError(500))

    await expect(service.loadDncKeys()).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })
})

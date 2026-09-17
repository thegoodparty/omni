import { BadGatewayException } from '@nestjs/common'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'
import { CallhubPhonebookService } from './callhubPhonebook.service'

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

describe('CallhubPhonebookService', () => {
  let service: CallhubPhonebookService
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() }
    service = new CallhubPhonebookService(
      createMockLogger(),
      http as unknown as CallhubHttpService,
      new CallhubErrorHandlingService(),
    )
  })

  it('creates a phonebook and reads the string pk_str id', async () => {
    http.post.mockResolvedValue({
      id: 3966566468442653936,
      pk_str: '3966566468442653936',
      name: 'Robocall audience',
    })

    const result = await service.createPhonebook({ name: 'Robocall audience' })

    expect(http.post).toHaveBeenCalledWith('/v1/phonebooks/', {
      name: 'Robocall audience',
      description: undefined,
    })
    expect(result.pk_str).toBe('3966566468442653936')
  })

  it('lists phonebooks from the paged envelope', async () => {
    http.get.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [{ pk_str: '1', name: 'Sample' }],
    })

    const result = await service.listPhonebooks()

    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('Sample')
  })

  it('reads the calling-number count from numbers_count', async () => {
    http.get.mockResolvedValue({
      phonenumber_count: 42,
      mobilenumber_count: 0,
    })

    const result = await service.getContactCount('3966566468442653936')

    expect(http.get).toHaveBeenCalledWith(
      '/v1/phonebooks/3966566468442653936/numbers_count',
    )
    expect(result).toBe(42)
  })

  it('maps a numbers_count HTTP failure to a 502', async () => {
    http.get.mockRejectedValue(axiosError(500))

    await expect(
      service.getContactCount('3966566468442653936'),
    ).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('lets a numbers_count schema mismatch propagate (not a 502)', async () => {
    http.get.mockResolvedValue({ unexpected: 'shape' })

    const call = service.getContactCount('3966566468442653936')
    await expect(call).rejects.not.toBeInstanceOf(BadGatewayException)
    await expect(call).rejects.toThrow()
  })

  it('maps a CallHub failure to a 502', async () => {
    http.post.mockRejectedValue(axiosError(500))

    await expect(service.createPhonebook({ name: 'x' })).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })
})

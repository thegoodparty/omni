import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'

const axiosError = (
  status: number,
  data: Record<string, unknown>,
): AxiosError => {
  const config = { url: '/x', headers: new AxiosHeaders() }
  const response = {
    data,
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

describe('CallhubErrorHandlingService', () => {
  let service: CallhubErrorHandlingService

  beforeEach(() => {
    service = new CallhubErrorHandlingService()
  })

  it('rethrows an already-mapped HttpException unchanged', () => {
    const original = new BadRequestException('bad input')

    expect(() =>
      service.handleApiError({ error: original, logger: createMockLogger() }),
    ).toThrow(original)
  })

  it('maps an axios error to a 502 without echoing the upstream body', () => {
    const err = axiosError(400, { error_message: 'account 12345 secret' })

    let thrown: unknown
    try {
      service.handleApiError({ error: err, logger: createMockLogger() })
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(BadGatewayException)
    const message = (thrown as BadGatewayException).message
    expect(message).toBe('CallHub API error')
    expect(message).not.toContain('secret')
  })

  it('uses the caller customMessage when provided', () => {
    const err = axiosError(500, { detail: 'throttled' })

    let thrown: unknown
    try {
      service.handleApiError({
        error: err,
        customMessage: 'CallHub number rental failed',
        logger: createMockLogger(),
      })
    } catch (e) {
      thrown = e
    }

    expect((thrown as BadGatewayException).message).toBe(
      'CallHub number rental failed',
    )
  })

  it('maps a non-axios error to a generic 502', () => {
    expect(() =>
      service.handleApiError({
        error: new Error('socket hang up'),
        logger: createMockLogger(),
      }),
    ).toThrow(BadGatewayException)
  })
})

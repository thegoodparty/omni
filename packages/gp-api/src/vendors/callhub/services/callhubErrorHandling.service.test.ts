import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import {
  CallhubErrorHandlingService,
  CallhubPermanentError,
} from './callhubErrorHandling.service'

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

  // The permanent subclass is what the robocall sweeps read to decide "fail the
  // run" vs "retry". A misclassified transient blip would permanently fail (and
  // void + email) a recoverable run.
  describe('permanent vs transient classification', () => {
    const classify = (status: number): unknown => {
      try {
        service.handleApiError({
          error: axiosError(status, {}),
          logger: createMockLogger(),
        })
      } catch (e) {
        return e
      }
    }

    it.each([400, 402, 403, 404])('classifies %i as permanent', (status) => {
      expect(classify(status)).toBeInstanceOf(CallhubPermanentError)
    })

    // 401 (auth) and 408 (timeout) are recoverable and must stay transient, so
    // an auth/timeout blip retries rather than permanently failing the run.
    it.each([401, 408, 429, 500, 502, 503])(
      'classifies %i as transient (retryable, not permanent)',
      (status) => {
        const thrown = classify(status)
        expect(thrown).toBeInstanceOf(BadGatewayException)
        expect(thrown).not.toBeInstanceOf(CallhubPermanentError)
      },
    )
  })
})

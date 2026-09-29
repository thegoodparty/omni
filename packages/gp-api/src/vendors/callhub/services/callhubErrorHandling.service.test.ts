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

    // CallHub reports its calls-per-second throttle as a 400, not a 429, so the
    // status alone reads it as permanent. The robocall send sweep acts on that
    // by voiding the hold and terminating a paid run (outreachId 83747,
    // 2026-09-29), which is why the body has to be consulted.
    const classifyBody = (
      status: number,
      data: Record<string, unknown>,
    ): unknown => {
      try {
        service.handleApiError({
          error: axiosError(status, data),
          logger: createMockLogger(),
        })
      } catch (e) {
        return e
      }
    }

    it('classifies a 400 over_cps_limit throttle as transient', () => {
      const thrown = classifyBody(400, { detail: 'over_cps_limit' })

      expect(thrown).toBeInstanceOf(BadGatewayException)
      expect(thrown).not.toBeInstanceOf(CallhubPermanentError)
    })

    it('still classifies other 400 detail codes as permanent', () => {
      expect(
        classifyBody(400, { detail: 'Status already changed!' }),
      ).toBeInstanceOf(CallhubPermanentError)
      expect(classifyBody(400, { detail: 'low_credit' })).toBeInstanceOf(
        CallhubPermanentError,
      )
    })

    // The detail is vendor-supplied, so it is not guaranteed to be a string.
    it('treats a non-string detail as permanent rather than throwing', () => {
      expect(
        classifyBody(400, { detail: { code: 'over_cps_limit' } }),
      ).toBeInstanceOf(CallhubPermanentError)
    })
  })
})

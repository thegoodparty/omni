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

  // An exhausted prepaid balance is the one 400 that is not a property of the
  // request: the same call succeeds once the account is topped up. Classifying
  // it permanent voided outreachId 83797's Stripe hold on 2026-09-27 and threw
  // away a compliance-passed, paid-for robocall run over a billing state that
  // cleared ~5h later. Both bodies below are the verbatim prod responses.
  describe('low account balance is transient, not permanent', () => {
    const throwFrom = (data: Record<string, unknown>): unknown => {
      try {
        service.handleApiError({
          error: axiosError(400, data),
          logger: createMockLogger(),
        })
      } catch (e) {
        return e
      }
    }

    // POST /v1/numbers/rent/ — nests the message under data.error, wrapped in
    // billing-link HTML.
    it('treats the number-rental low-credit 400 as transient', () => {
      const thrown = throwFrom({
        data: {
          error:
            'Error: You do not have enough credits to buy this number. ' +
            'Please <a href="/billing/" class="open-recharge-modal">add ' +
            'credits</a> to your account now.',
        },
      })
      expect(thrown).toBeInstanceOf(BadGatewayException)
      expect(thrown).not.toBeInstanceOf(CallhubPermanentError)
    })

    // PUT /v1/voice_broadcasts/<pk>/ — a bare DRF detail code. This is the one
    // that reached reconcileDialing and voided the hold.
    it('treats the voice-broadcast launch low_credit 400 as transient', () => {
      const thrown = throwFrom({ detail: 'low_credit' })
      expect(thrown).toBeInstanceOf(BadGatewayException)
      expect(thrown).not.toBeInstanceOf(CallhubPermanentError)
    })

    it('logs a CRITICAL line the balance alert can key off', () => {
      const logger = createMockLogger()
      try {
        service.handleApiError({
          error: axiosError(400, { detail: 'low_credit' }),
          logger,
        })
      } catch {
        // expected
      }
      expect(logger.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('CRITICAL CallHub account balance exhausted'),
      )
    })

    // The guard must not swallow the permanence of a genuinely bad request:
    // a 400 that is not about the balance still fails the run permanently.
    it('leaves an unrelated 400 permanent', () => {
      const thrown = throwFrom({
        data: {
          error: 'We are currently unable to offer your requested numbers',
        },
      })
      expect(thrown).toBeInstanceOf(CallhubPermanentError)
    })
  })
})

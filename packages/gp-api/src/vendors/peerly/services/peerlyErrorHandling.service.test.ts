import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import type { PinoLogger } from 'nestjs-pino'
import { describe, expect, it, vi } from 'vitest'
import { PeerlyErrorHandlingService } from './peerlyErrorHandling.service'

const TINYURL_MESSAGE =
  'Message cannot contain tinyurl.com links. Please correct your message.'

const axiosError = (data: object, status = 400) => {
  const config = { url: '/1to1/jobs', method: 'post', headers: {} }
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    config,
    response: { status, data, headers: {}, config },
  })
}

// Only the two levels this service writes. Cast at the boundary so the tests
// can assert on calls without standing up a real PinoLogger.
const fakeLogger = () => {
  const logger = { error: vi.fn(), warn: vi.fn() }
  return { logger, asPino: logger as unknown as PinoLogger }
}

describe('PeerlyErrorHandlingService', () => {
  const service = new PeerlyErrorHandlingService()

  it('surfaces a template content rejection as a 400 with Peerly’s message', async () => {
    const error = axiosError({
      Errors: { templates: [{ non_field_errors: [TINYURL_MESSAGE] }] },
    })

    const promise = service.handleApiError({ error })
    await expect(promise).rejects.toThrow(BadRequestException)
    await expect(promise).rejects.toThrow(TINYURL_MESSAGE)
  })

  it('joins multiple template error messages', async () => {
    const error = axiosError({
      Errors: {
        templates: [
          { non_field_errors: ['First problem.'], text: ['Second problem.'] },
        ],
      },
    })

    await expect(service.handleApiError({ error })).rejects.toThrow(
      'First problem. Second problem.',
    )
  })

  it('keeps the caller’s customMessage framing over template errors', async () => {
    const error = axiosError({
      Errors: { templates: [{ non_field_errors: [TINYURL_MESSAGE] }] },
    })

    const promise = service.handleApiError({
      error,
      context: { customMessage: 'Failed to assign list to P2P job' },
    })
    await expect(promise).rejects.toThrow(BadGatewayException)
    await expect(promise).rejects.toThrow('Failed to assign list to P2P job')
  })

  it('parses the singular error field into the 502 message', async () => {
    const error = axiosError({ error: 'account_id required' })

    const promise = service.handleApiError({ error })
    await expect(promise).rejects.toThrow(BadGatewayException)
    await expect(promise).rejects.toThrow(
      'Peerly API error: account_id required',
    )
  })

  it('falls back to Unknown API error for an unrecognized body', async () => {
    const promise = service.handleApiError({
      error: axiosError({ something: 'else' }),
    })
    await expect(promise).rejects.toThrow(BadGatewayException)
    await expect(promise).rejects.toThrow('Peerly API error: Unknown API error')
  })

  it('does not 400 a template-shaped body on a 5xx response', async () => {
    const error = axiosError(
      { Errors: { templates: [{ non_field_errors: [TINYURL_MESSAGE] }] } },
      502,
    )

    const promise = service.handleApiError({ error })
    await expect(promise).rejects.toThrow(BadGatewayException)
    await expect(promise).rejects.toThrow('Peerly API error: Unknown API error')
  })

  it('does not 400 an Errors body without template messages', async () => {
    const promise = service.handleApiError({
      error: axiosError({ Errors: { templates: [] } }),
    })
    await expect(promise).rejects.toThrow(BadGatewayException)
    await expect(promise).rejects.toThrow('Peerly API error: Unknown API error')
  })

  it('rethrows an HttpException unchanged when no customMessage is set', async () => {
    const original = new NotFoundException('job not found')

    await expect(service.handleApiError({ error: original })).rejects.toBe(
      original,
    )
  })

  // The level of these lines is what decides whether win-peerly-warnings pages
  // win-bugs: the rule counts error-level lines carrying 'Peerly API ERROR'.
  describe('log level', () => {
    // Peerly proxies CampaignVerify and collapses its answer into a 400 with
    // CV's own status echoed in status_code. This is the prod shape.
    const cvPinFailure = (nestedStatus: number) =>
      axiosError({
        Error: 'Campaign Verify Verify PIN API request failed.',
        status_code: nestedStatus,
      })

    it('logs at error by default, so a real fault still pages', async () => {
      const { logger, asPino } = fakeLogger()

      await expect(
        service.handleApiError({
          error: cvPinFailure(500),
          logger: asPino,
        }),
      ).rejects.toThrow(BadGatewayException)

      expect(logger.error).toHaveBeenCalled()
      expect(logger.warn).not.toHaveBeenCalled()
    })

    // The incident: a candidate mistyping a PIN paged win-bugs 18 times in 14
    // days, because the caller's classification never reached the log level.
    it('logs an expected rejection at warn, on every line it writes', async () => {
      const { logger, asPino } = fakeLogger()

      await expect(
        service.handleApiError({
          error: cvPinFailure(422),
          context: { expectedRejection: true },
          logger: asPino,
        }),
      ).rejects.toThrow(BadGatewayException)

      // Both the summary line and the response-detail line, or the detail line
      // alone keeps the alert firing.
      expect(logger.warn).toHaveBeenCalledTimes(2)
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('still logs at error when the caller did not classify it', async () => {
      const { logger, asPino } = fakeLogger()

      await expect(
        service.handleApiError({
          error: cvPinFailure(422),
          context: { expectedRejection: false },
          logger: asPino,
        }),
      ).rejects.toThrow(BadGatewayException)

      expect(logger.error).toHaveBeenCalled()
      expect(logger.warn).not.toHaveBeenCalled()
    })

    // The second incident on this alert: Campaign Verify began refusing every
    // status read, and the poll that re-reads each record every 30 minutes
    // paged once per failed read. The sweep's own per-record error line is what
    // carries that signal now.
    it('logs a swept read the caller will retry at warn', async () => {
      const { logger, asPino } = fakeLogger()

      await expect(
        service.handleApiError({
          error: axiosError({
            Error: 'Campaign Verify Retrieve API request failed.',
            status_code: 403,
          }),
          context: { handledByCaller: true },
          logger: asPino,
        }),
      ).rejects.toThrow(BadGatewayException)

      expect(logger.warn).toHaveBeenCalledTimes(2)
      expect(logger.error).not.toHaveBeenCalled()
    })

    // The same vendor refusal on a read a candidate is waiting on is a fault
    // somebody must see now, so only the caller that retries may downgrade it.
    it('keeps the same failure at error when nobody will retry it', async () => {
      const { logger, asPino } = fakeLogger()

      await expect(
        service.handleApiError({
          error: axiosError({
            Error: 'Campaign Verify Retrieve API request failed.',
            status_code: 403,
          }),
          context: { suppressSlackAlert: true },
          logger: asPino,
        }),
      ).rejects.toThrow(BadGatewayException)

      expect(logger.error).toHaveBeenCalled()
      expect(logger.warn).not.toHaveBeenCalled()
    })

    // A content rejection is surfaced to the user as a 400 carrying Peerly's
    // own wording, so it is self-service, not an incident. Nothing has to be
    // passed for this one — the body is enough to recognize it.
    it('logs a template content rejection at warn without being told to', async () => {
      const { logger, asPino } = fakeLogger()
      const error = axiosError({
        Errors: { templates: [{ non_field_errors: [TINYURL_MESSAGE] }] },
      })

      await expect(
        service.handleApiError({ error, logger: asPino }),
      ).rejects.toThrow(BadRequestException)

      expect(logger.warn).toHaveBeenCalledTimes(2)
      expect(logger.error).not.toHaveBeenCalled()
    })

    // The 5xx guard on the throw path has to hold for the level too: a vendor
    // outage wearing a template-shaped body is exactly what must keep paging.
    it('keeps a 5xx at error even with a template-shaped body', async () => {
      const { logger, asPino } = fakeLogger()
      const error = axiosError(
        { Errors: { templates: [{ non_field_errors: [TINYURL_MESSAGE] }] } },
        502,
      )

      await expect(
        service.handleApiError({ error, logger: asPino }),
      ).rejects.toThrow(BadGatewayException)

      expect(logger.error).toHaveBeenCalled()
      expect(logger.warn).not.toHaveBeenCalled()
    })

    // customMessage means the caller reframed the failure for its own recovery
    // path, so it is not the self-service 400 the warn level is justified by.
    it('keeps a reframed template rejection at error', async () => {
      const { logger, asPino } = fakeLogger()
      const error = axiosError({
        Errors: { templates: [{ non_field_errors: [TINYURL_MESSAGE] }] },
      })

      await expect(
        service.handleApiError({
          error,
          context: { customMessage: 'Failed to assign list to P2P job' },
          logger: asPino,
        }),
      ).rejects.toThrow(BadGatewayException)

      expect(logger.error).toHaveBeenCalled()
      expect(logger.warn).not.toHaveBeenCalled()
    })
  })
})

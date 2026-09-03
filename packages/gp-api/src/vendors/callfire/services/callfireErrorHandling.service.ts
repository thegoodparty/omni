import { BadGatewayException, HttpException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { VendorPermanentError } from '@/outreach/vendor/vendorPermanentError'

// CallFire returns errors as JSON carrying `message` (and a numeric `code` /
// `httpStatusCode`). We surface a short message and always map to 502 — a
// vendor failure, not a client error.
interface CallfireErrorData {
  message?: string
  code?: number
  [key: string]: unknown
}

interface CallfireErrorInfo {
  error: unknown
  // Overrides the generic message shown to the caller.
  customMessage?: string
  logger?: PinoLogger
}

// 401 (auth — a rotated/expired credential recovers on the next attempt), 408
// (request timeout), and 429 (throttle) are recoverable and stay transient so
// a CallFire blip retries instead of permanently failing (and voiding +
// emailing) a run. Every other 4xx is a permanent client/validation error.
const RECOVERABLE_4XX = [401, 408, 429]

@Injectable()
export class CallfireErrorHandlingService {
  handleApiError(info: CallfireErrorInfo): never {
    const { error, customMessage, logger } = info
    const generic = 'CallFire API error'

    // An already-mapped HttpException (e.g. a BadRequest we threw upstream)
    // propagates unchanged.
    if (error instanceof HttpException) {
      logger?.error({ err: error }, generic)
      throw error
    }

    if (isAxiosError<CallfireErrorData>(error)) {
      const status = error.response?.status
      const data = error.response?.data
      const parsed =
        data?.message ?? (data ? JSON.stringify(data) : error.message)
      // Log the status + parsed body but never the request headers (they carry
      // the Authorization Basic secret). The client-facing message stays
      // generic — the upstream body can carry account detail.
      logger?.error({ status, data }, `${generic}: ${parsed}`)
      // A 4xx is permanent (retrying never succeeds) EXCEPT the recoverable
      // ones. Both classes are 502s; the subclass only signals "permanent" to
      // callers that retry.
      const permanent =
        typeof status === 'number' &&
        status >= 400 &&
        status < 500 &&
        !RECOVERABLE_4XX.includes(status)
      throw permanent
        ? new VendorPermanentError(customMessage ?? generic, { cause: error })
        : new BadGatewayException(customMessage ?? generic, { cause: error })
    }

    logger?.error({ err: error }, generic)
    throw new BadGatewayException(customMessage ?? generic, { cause: error })
  }
}

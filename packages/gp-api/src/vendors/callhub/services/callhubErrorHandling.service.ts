import { BadGatewayException, HttpException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'

// CallHub returns errors as { error_message } (e.g. the deprecated-host 403),
// { detail } (DRF throttle/permission), or DRF field maps. We surface a short
// message and always map to 502 — a vendor failure, not a client error.
interface CallhubErrorData {
  error_message?: string
  detail?: string
  [key: string]: unknown
}

interface CallhubErrorInfo {
  error: unknown
  // Overrides the generic message shown to the caller.
  customMessage?: string
  logger?: PinoLogger
}

// A PERMANENT CallHub failure: a 4xx client/validation error (a bad request
// that will not succeed on retry), as opposed to a transient 5xx / network
// failure or a 429 throttle. Extends BadGatewayException so the HTTP status and
// generic message are UNCHANGED for every caller (a CallHub error is still a
// 502 vendor failure to the client) — the distinct class only lets a caller
// that retries (the robocall send sweeps) tell "stop retrying, this is
// permanent" from "retry, this was transient". 429 stays transient (throttle).
export class CallhubPermanentError extends BadGatewayException {}

@Injectable()
export class CallhubErrorHandlingService {
  handleApiError(info: CallhubErrorInfo): never {
    const { error, customMessage, logger } = info
    const generic = 'CallHub API error'

    // An already-mapped HttpException (e.g. a BadRequest we threw upstream)
    // propagates unchanged.
    if (error instanceof HttpException) {
      logger?.error({ err: error }, generic)
      throw error
    }

    if (isAxiosError<CallhubErrorData>(error)) {
      const status = error.response?.status
      const data = error.response?.data
      const parsed =
        data?.error_message ??
        data?.detail ??
        (data ? JSON.stringify(data) : error.message)
      // Log the status + parsed body but never the request headers (they carry
      // the Authorization: Token secret). The client-facing message stays
      // generic — the upstream body can carry account/number detail.
      logger?.error({ status, data }, `${generic}: ${parsed}`)
      // A 4xx (never a 429 throttle) is a permanent client/validation error —
      // retrying it will never succeed. Both classes are 502s; the subclass only
      // signals "permanent" to callers that retry.
      const permanent =
        typeof status === 'number' &&
        status >= 400 &&
        status < 500 &&
        status !== 429
      throw permanent
        ? new CallhubPermanentError(customMessage ?? generic, { cause: error })
        : new BadGatewayException(customMessage ?? generic, { cause: error })
    }

    logger?.error({ err: error }, generic)
    throw new BadGatewayException(customMessage ?? generic, { cause: error })
  }
}

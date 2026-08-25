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
      throw new BadGatewayException(customMessage ?? generic, { cause: error })
    }

    logger?.error({ err: error }, generic)
    throw new BadGatewayException(customMessage ?? generic, { cause: error })
  }
}

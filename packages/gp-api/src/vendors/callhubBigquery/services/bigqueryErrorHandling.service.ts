import { BadGatewayException, HttpException, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { BigqueryPermanentError } from '../errors/bigqueryPermanentError'

interface BigqueryErrorInfo {
  error: unknown
  // Overrides the generic message shown to the caller.
  customMessage?: string
  logger?: PinoLogger
}

// PERMANENT: a request that will not succeed on retry — 400 (bad SQL / invalid
// request), 401 / 403 (auth / access not granted), 404 (dataset or table not
// found). Everything else is TRANSIENT and safe to retry a bounded number of
// times: 429 (rateLimitExceeded), 5xx (500 / 502 / 503 / 504), and any string
// errno network failure. Reads have no side effect, so retrying a transient
// class can never double-bill anything — but the retry stays bounded regardless
// (see the client service).
const PERMANENT_HTTP_STATUSES = [400, 401, 403, 404]

// A BigQuery client failure carries an HTTP status on `code` (a number) plus an
// `errors[]` list; a Node network failure instead carries a string errno on
// `code` (ECONNRESET, ETIMEDOUT, ...). We only need the code to classify.
export const getBigqueryErrorCode = (
  error: unknown,
): number | string | undefined => {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const { code } = error
    if (typeof code === 'number' || typeof code === 'string') {
      return code
    }
  }
  return undefined
}

export const isPermanentBigqueryError = (error: unknown): boolean => {
  const code = getBigqueryErrorCode(error)
  return typeof code === 'number' && PERMANENT_HTTP_STATUSES.includes(code)
}

@Injectable()
export class BigqueryErrorHandlingService {
  // Maps any BigQuery query failure to a 502-family error, preserving the
  // permanent-vs-transient distinction on the type. Never logs the SQL
  // parameters — they can carry voter phone numbers; only the error and its
  // code are logged.
  handleQueryError(info: BigqueryErrorInfo): never {
    const { error, customMessage, logger } = info
    const generic = 'CallHub BigQuery query error'

    // An already-mapped HttpException propagates unchanged.
    if (error instanceof HttpException) {
      logger?.error({ err: error }, generic)
      throw error
    }

    const code = getBigqueryErrorCode(error)
    logger?.error({ err: error, code }, generic)
    const message = customMessage ?? generic
    throw isPermanentBigqueryError(error)
      ? new BigqueryPermanentError(message, { cause: error })
      : new BadGatewayException(message, { cause: error })
  }
}

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

// CallHub `detail` codes that arrive on a 4xx but are NOT properties of the
// request, so the identical call succeeds on the next attempt.
//
// `over_cps_limit` is CallHub's calls-per-second throttle. It is the same kind
// of condition as the 429 already on RECOVERABLE_4XX below — "too much dialing
// in flight right now, ask again later" — but CallHub reports it as a 400, so
// the HTTP status alone cannot see that it is a throttle and it lands on the
// permanent side of a list whose whole purpose is to keep throttles off it.
//
// WHY A MISCLASSIFICATION HERE IS EXPENSIVE, and why this is matched on the
// body rather than left to the status: the robocall send sweep reads
// CallhubPermanentError as "the START was definitively refused, fail the run",
// which voids the candidate's Stripe hold and makes a staged, paid,
// compliance-passed robocall terminal `send_failed` that no sweep revives. On
// 2026-09-29 that discarded outreachId 83747 over a throttle that had cleared
// long before anyone read the alert. Transient instead means `reconcileDialing`
// reverts the run to `authorized` on a confirmed-PAUSED status read and the next
// sweep relaunches it, bounded by the Stripe hold window — a hold that lapses
// first lands in `hold_failed` with a candidate milestone, so retrying cannot
// run forever or silently drop a run.
//
// Add to this list only a code that is genuinely recoverable by waiting. A code
// that describes the request (a rejected caller ID, a malformed payload) belongs
// on the permanent side, because retrying it burns the hold window to no end.
const RECOVERABLE_4XX_DETAILS = ['over_cps_limit']

const isRecoverableDetail = (data?: CallhubErrorData): boolean => {
  const detail = data?.detail
  return (
    typeof detail === 'string' &&
    RECOVERABLE_4XX_DETAILS.includes(detail.trim().toLowerCase())
  )
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
      // A 4xx is a permanent client/validation error — retrying it will never
      // succeed — EXCEPT the recoverable ones, which stay transient so a CallHub
      // blip retries instead of permanently failing (and voiding + emailing) a
      // run: 429 (throttle), 401 (auth — a rotated/expired token recovers on the
      // next attempt), and 408 (request timeout). 403 stays permanent: the
      // generic/deprecated host 403s (see callhub config). Both classes are
      // 502s; the subclass only signals "permanent" to callers that retry.
      // Recoverable by STATUS (the whole class retries) or by BODY (a specific
      // code on an otherwise-permanent status — see RECOVERABLE_4XX_DETAILS).
      const RECOVERABLE_4XX = [401, 408, 429]
      const permanent =
        typeof status === 'number' &&
        status >= 400 &&
        status < 500 &&
        !RECOVERABLE_4XX.includes(status) &&
        !isRecoverableDetail(data)
      throw permanent
        ? new CallhubPermanentError(customMessage ?? generic, { cause: error })
        : new BadGatewayException(customMessage ?? generic, { cause: error })
    }

    logger?.error({ err: error }, generic)
    throw new BadGatewayException(customMessage ?? generic, { cause: error })
  }
}

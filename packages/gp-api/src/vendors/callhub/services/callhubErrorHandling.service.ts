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

// CallHub answers 400 when OUR prepaid account has no balance left, and says so
// in two different shapes depending on the endpoint:
//
//   POST /v1/numbers/rent/      { data: { error: "Error: You do not have enough
//                                 credits to buy this number. Please <a ...>add
//                                 credits</a> to your account now." } }
//   PUT  /v1/voice_broadcasts/  { detail: "low_credit" }
//
// This is the one 400 that is NOT a property of the request: the identical call
// succeeds once someone tops the account up, which makes it recoverable in
// exactly the sense 401 and 429 already are. Classifying it permanent is what
// voided outreachId 83797's Stripe hold on 2026-09-27 — a compliance-passed,
// paid-for run discarded over a billing state that cleared ~5h later.
//
// Matched on the body rather than the status because the status cannot tell the
// difference: a genuinely bad rental request is also a 400 and must still fail
// permanently. Both needles are CallHub's own wording; `low_credit` is an exact
// DRF `detail` code, and the rental prose is matched on its stable middle
// ("enough credits") so the surrounding billing-link HTML can change freely.
const LOW_BALANCE_NEEDLES = ['low_credit', 'enough credits']

const isLowBalance = (data: CallhubErrorData | undefined): boolean => {
  if (!data) return false
  // Serialize the whole body: the two shapes nest the message differently
  // (`data.error` vs `detail`), and a third endpoint would likely invent a
  // fourth place to put it. A needle this specific cannot collide with
  // unrelated content.
  const haystack = JSON.stringify(data).toLowerCase()
  return LOW_BALANCE_NEEDLES.some((needle) => haystack.includes(needle))
}

// A PERMANENT CallHub failure: a 4xx client/validation error (a bad request
// that will not succeed on retry), as opposed to a transient 5xx / network
// failure, a 429 throttle, or an exhausted account balance. Extends
// BadGatewayException so the HTTP status and generic message are UNCHANGED for
// every caller (a CallHub error is still a 502 vendor failure to the client) —
// the distinct class only lets a caller that retries (the robocall send sweeps)
// tell "stop retrying, this is permanent" from "retry, this was transient".
// 429 stays transient (throttle), as does a low-balance 400 (see isLowBalance).
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
      // A 4xx is a permanent client/validation error — retrying it will never
      // succeed — EXCEPT the recoverable ones, which stay transient so a CallHub
      // blip retries instead of permanently failing (and voiding + emailing) a
      // run: 429 (throttle), 401 (auth — a rotated/expired token recovers on the
      // next attempt), and 408 (request timeout). 403 stays permanent: the
      // generic/deprecated host 403s (see callhub config). A low-balance 400 is
      // recoverable too, but is identified by its BODY rather than its status —
      // see LOW_BALANCE_NEEDLES. Both classes are 502s; the subclass only
      // signals "permanent" to callers that retry.
      const RECOVERABLE_4XX = [401, 408, 429]
      const lowBalance = isLowBalance(data)
      if (lowBalance) {
        // Logged distinctly because it is an operational condition with an
        // owner and a remedy (top up the CallHub account), not a code fault —
        // and because the `callhub-account-low-balance` global alert keys off
        // this exact line. Without it, an exhausted account is first discovered
        // by a candidate getting a 502.
        logger?.error(
          { status },
          'CRITICAL CallHub account balance exhausted: CallHub rejected the ' +
            'request for lack of credits. Top up the CallHub account — ' +
            'robocall number rental and voice-broadcast launch are both ' +
            'failing until it is topped up.',
        )
      }
      const permanent =
        typeof status === 'number' &&
        status >= 400 &&
        status < 500 &&
        !RECOVERABLE_4XX.includes(status) &&
        !lowBalance
      throw permanent
        ? new CallhubPermanentError(customMessage ?? generic, { cause: error })
        : new BadGatewayException(customMessage ?? generic, { cause: error })
    }

    logger?.error({ err: error }, generic)
    throw new BadGatewayException(customMessage ?? generic, { cause: error })
  }
}

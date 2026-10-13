import { BadGatewayException, HttpStatus } from '@nestjs/common'
import { isAxiosError } from 'axios'

// Peerly's CampaignVerify submit_cv returns HTTP 400 carrying one of these
// messages (nested under `details`, sometimes echoed at the top level) when
// their own account can't be billed. It is a Peerly-side billing/account
// outage, not a transient network error — retrying re-fails deterministically
// until Peerly fixes billing — so we treat it as a distinct, non-retryable
// failure class.
export const PEERLY_NO_PAYMENT_METHOD_MESSAGE = 'No payment method available'

// The same outage surfaces as this top-level `Error` when the Peerly account
// has run out of funds rather than lost its card. Prod hit it ~74 times on
// 2026-10-02 (ENG-11255); with no match here it fell through to the generic
// 502, so there was no hold and no Slack alert, and every candidate who
// submitted in that window stalled with no identity.
export const PEERLY_INSUFFICIENT_BALANCE_MESSAGE =
  'Insufficient balance to submit CV'

// Thrown in place of the generic BadGatewayException when a Peerly call fails
// with the billing/account error, so callers can persist a hold and stop the
// re-dispatch storm. Still surfaces as a 502 (extends BadGatewayException).
export class PeerlyBillingException extends BadGatewayException {}

type PeerlyBillingErrorBody = {
  Error?: string
  message?: string
  details?: { message?: string } | string | null
}

const containsBillingMessage = (value?: string | null): boolean =>
  typeof value === 'string' &&
  (value.includes(PEERLY_NO_PAYMENT_METHOD_MESSAGE) ||
    value.includes(PEERLY_INSUFFICIENT_BALANCE_MESSAGE))

export const isPeerlyBillingError = (error: unknown): boolean => {
  if (!isAxiosError<PeerlyBillingErrorBody>(error)) {
    return false
  }
  if (error.response?.status !== HttpStatus.BAD_REQUEST) {
    return false
  }
  const data = error.response.data
  const detailMessage =
    typeof data?.details === 'string' ? data.details : data?.details?.message
  return (
    containsBillingMessage(detailMessage) ||
    containsBillingMessage(data?.message) ||
    containsBillingMessage(data?.Error)
  )
}

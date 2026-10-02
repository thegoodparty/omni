import { BadGatewayException, HttpStatus } from '@nestjs/common'
import { isAxiosError } from 'axios'

// Peerly's CampaignVerify submit_cv returns HTTP 400 carrying one of these
// messages when the submission cannot be paid for. `No payment method
// available` arrives nested under `details` (sometimes echoed at the top
// level); `Insufficient balance` arrives as a bare top-level `Error` (observed
// in prod 2026-10-02: {"Error":"Insufficient balance to submit CV. Please add
// funds to your account."}). Either is a billing/account condition, not a
// transient network error — retrying re-fails deterministically until somebody
// adds funds or fixes the payment method — so we treat both as the same
// distinct, non-retryable failure class.
export const PEERLY_NO_PAYMENT_METHOD_MESSAGE = 'No payment method available'
export const PEERLY_INSUFFICIENT_BALANCE_MESSAGE = 'Insufficient balance'

const PEERLY_BILLING_MESSAGES = [
  PEERLY_NO_PAYMENT_METHOD_MESSAGE,
  PEERLY_INSUFFICIENT_BALANCE_MESSAGE,
]

// Thrown in place of the generic BadGatewayException when a Peerly call fails
// with the billing/account error, so callers can persist a hold and stop the
// re-dispatch storm. Still surfaces as a 502 (extends BadGatewayException).
export class PeerlyBillingException extends BadGatewayException {}

type PeerlyBillingErrorBody = {
  message?: string
  // Peerly's own refusals (as opposed to a relayed CampaignVerify one) come
  // back as a bare top-level `Error` sentence with nothing nested under it.
  Error?: string
  details?: { message?: string } | string | null
}

const billingMessageIn = (value?: string | null): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  return PEERLY_BILLING_MESSAGES.some((marker) => value.includes(marker))
    ? value
    : null
}

// The sentence Peerly actually sent, so the Slack alert and the exception name
// the real condition ("add funds" reads very differently from "no payment
// method") instead of a hard-coded guess at which one it was. Null when this is
// not a billing failure.
export const getPeerlyBillingMessage = (error: unknown): string | null => {
  if (!isAxiosError<PeerlyBillingErrorBody>(error)) {
    return null
  }
  if (error.response?.status !== HttpStatus.BAD_REQUEST) {
    return null
  }
  const data = error.response.data
  const detailMessage =
    typeof data?.details === 'string' ? data.details : data?.details?.message
  return (
    billingMessageIn(detailMessage) ??
    billingMessageIn(data?.message) ??
    billingMessageIn(data?.Error)
  )
}

export const isPeerlyBillingError = (error: unknown): boolean =>
  getPeerlyBillingMessage(error) !== null

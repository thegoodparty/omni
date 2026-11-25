// Stripe reports a failed embedded-checkout payment as `paymentFailed` with an
// optional issuer reason, and its classic errors as a `code` plus sometimes a
// `decline_code`. @stripe/stripe-js types the classic shape only, so the
// checkout shape is read here defensively.
type StripeFailure = {
  message?: string | null
  code?: string | null
  decline_code?: string | null
  paymentFailed?: { declineCode?: string | null } | null
}

// Codes Stripe returns when the customer's payment method cannot be charged for
// a reason the customer can fix.
const CARD_DECLINE_CODES = new Set([
  'card_declined',
  'expired_card',
  'incorrect_cvc',
  'insufficient_funds',
  'authentication_failure',
])

/**
 * Whether a Stripe failure is the customer's card being declined, rather than
 * something wrong with our integration. A decline is an expected outcome of
 * taking payment: the customer retries with another card and nothing in our
 * code changes it. Reporting it as a client exception put every decline in the
 * exception stream the new-error alert pages on, indistinguishable from a
 * defect we shipped (ENG-11776).
 *
 * `code === 'paymentFailed'` is the embedded checkout's code for an attempt the
 * bank refused; its `paymentFailed.declineCode` is null when the issuer gives no
 * reason, so the code alone decides it.
 */
export const isCardDecline = (error: StripeFailure): boolean =>
  error.code === 'paymentFailed' ||
  (typeof error.code === 'string' && CARD_DECLINE_CODES.has(error.code)) ||
  typeof error.decline_code === 'string'

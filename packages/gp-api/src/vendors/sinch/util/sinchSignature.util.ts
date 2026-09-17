import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Sinch signs callbacks as
 *   base64(HMAC-SHA256(secret, `${rawBody}.${nonce}.${timestamp}`))
 * and sends the parts in `x-sinch-webhook-signature*` headers.
 *
 * The digest is over the *raw* body: any JSON parse/re-serialize changes the
 * bytes and the signature will not match.
 */
export const SINCH_SIGNATURE_HEADER = 'x-sinch-webhook-signature'
export const SINCH_NONCE_HEADER = 'x-sinch-webhook-signature-nonce'
export const SINCH_TIMESTAMP_HEADER = 'x-sinch-webhook-signature-timestamp'

/**
 * How far ahead of our clock a callback's signature time may be.
 *
 * There is no matching bound on the past, and that is the point. Sinch retries
 * with exponential backoff "until the maximum retry period is reached", does
 * not document what that period is, and — per their own guidance — does not
 * re-sign a retry: it arrives with the timestamp and signature of the original.
 * So any staleness cutoff is a guess about their backoff, and guessing short
 * means rejecting a real STOP that took too long to get through. That failure
 * is worse than the replay it would prevent, because it leaves us texting
 * someone who asked us to stop.
 *
 * Freshness is therefore not what defends this endpoint — `smsOptEventAt` in
 * SmsOptOutService is, by refusing to apply a callback older than the state it
 * would overwrite. Replaying a captured STOP after a real START, or a captured
 * START after a real STOP, is exactly the case that guard rejects, and it does
 * it without caring how old the replay is.
 *
 * The future bound is still worth having, and it protects that guard rather
 * than the signature: a timestamp years ahead would pin `smsOptEventAt` past
 * every real event that follows, so no genuine STOP could ever apply again. It
 * takes a Sinch clock fault to produce one (an attacker cannot sign), which is
 * why the allowance is generous — it only has to exclude the absurd.
 */
const MAX_FUTURE_SKEW_SECONDS = 15 * 60

/**
 * The signature's timestamp as a Date, or null if it is not a plain Unix-second
 * integer or sits implausibly far in our future.
 *
 * Callers use this as the callback's event time. It is safe to trust that far
 * because it is inside the HMAC preimage — altering it invalidates the
 * signature — so it is authenticated in a way the request body's own clock
 * fields are not.
 */
export function parseSinchTimestamp(
  timestamp: string | undefined,
  now: Date = new Date(),
): Date | null {
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return null
  const seconds = Number(timestamp)
  if (!Number.isSafeInteger(seconds)) return null
  const at = new Date(seconds * 1000)
  if (at.getTime() - now.getTime() > MAX_FUTURE_SKEW_SECONDS * 1000) return null
  return at
}

export function verifySinchSignature(args: {
  rawBody: string
  signature?: string
  nonce?: string
  timestamp?: string
  secret: string
}): boolean {
  const { rawBody, signature, nonce, timestamp, secret } = args
  if (!signature || !nonce || !timestamp || !secret) return false

  const expected = createHmac('sha256', secret)
    .update(`${rawBody}.${nonce}.${timestamp}`)
    .digest('base64')

  const provided = Buffer.from(signature)
  const computed = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, so compare lengths first; that
  // leaks only the length, not the contents.
  return (
    provided.length === computed.length && timingSafeEqual(provided, computed)
  )
}

// Carrier-standard opt-out keywords. Sinch and the carriers suppress these
// themselves, but we record them so our own sends stop too — and so "did this
// person opt out" is answerable from our database.
const OPT_OUT_KEYWORDS = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'REVOKE',
  'OPTOUT',
])

// Opting back in. Deliberately narrow: only an explicit resubscribe keyword
// clears a recorded opt-out.
const OPT_IN_KEYWORDS = new Set(['START', 'UNSTOP', 'YES', 'OPTIN'])

export type InboundIntent = 'opt_out' | 'opt_in' | 'other'

/**
 * Classifies an inbound message body. Keywords are matched on the whole trimmed
 * message rather than as a substring, so "please don't cancel my account" is not
 * treated as an opt-out.
 */
export function classifyInboundMessage(
  body: string | undefined,
): InboundIntent {
  const normalized = (body ?? '')
    .trim()
    .toUpperCase()
    // Strip surrounding punctuation so "STOP." and "STOP!" still register.
    .replace(/^[^A-Z]+|[^A-Z]+$/g, '')
  if (OPT_OUT_KEYWORDS.has(normalized)) return 'opt_out'
  if (OPT_IN_KEYWORDS.has(normalized)) return 'opt_in'
  return 'other'
}

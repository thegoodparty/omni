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

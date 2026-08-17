export type SendSmsInput = {
  to: string
  body: string
}

/**
 * SMS sends are best-effort by design: the magic link is still returned to the
 * rep to copy when delivery fails, so callers need a result they can surface
 * rather than an exception to swallow.
 */
export type SendSmsResult =
  | { sent: true; messageId: string | null }
  | { sent: false; error: string }

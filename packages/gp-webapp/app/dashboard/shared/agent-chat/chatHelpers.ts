import type { ChatErrorCode } from './chatTypes'

// Stable per-message id, sent with each turn and preserved across retries so
// the server can dedupe. Prefers crypto.randomUUID, with a plain fallback.
export const newClientMessageId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `cmid_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

const FRIENDLY_ERROR: Record<ChatErrorCode, string> = {
  rate_limited: 'Too many requests. Try again in a moment.',
  upstream_unavailable: 'Chat is temporarily unavailable. Try again.',
  aborted: '',
  conversation_not_found:
    'This chat is no longer available. Try starting a new one.',
  internal: 'Something went wrong. Try again.',
}

export const friendlyError = (code: ChatErrorCode): string =>
  FRIENDLY_ERROR[code] ?? 'Something went wrong. Try again.'

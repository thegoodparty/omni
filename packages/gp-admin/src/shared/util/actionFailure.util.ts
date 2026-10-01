// A server action that throws in prod reaches the client with its message
// redacted, and a call that fails in transit (a tab from an older deploy
// calling a server-action id the current deploy no longer serves, an expired
// session) never reaches gp-api at all — so the client-side catch is the only
// place either failure can be turned into something a staff member can act on.
const DEPLOY_SKEW_MARKERS = [
  'Failed to find Server Action',
  'older or newer deployment',
]

export const DEPLOY_SKEW_MESSAGE =
  'The admin console was updated since this page loaded — refresh the page ' +
  'and try again.'

export const describeActionFailure = (
  error: unknown,
  fallback: string
): string => {
  if (!(error instanceof Error)) return fallback
  if (DEPLOY_SKEW_MARKERS.some((marker) => error.message.includes(marker))) {
    return DEPLOY_SKEW_MESSAGE
  }
  const digest =
    'digest' in error && typeof error.digest === 'string' ? error.digest : null
  if (digest && error.message.includes('Server Action')) {
    return `${fallback} (server error, digest ${digest})`
  }
  return error.message || fallback
}

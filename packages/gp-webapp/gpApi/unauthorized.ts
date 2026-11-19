import { isSafeInternalPath } from 'helpers/isSafeInternalPath'
import { isPublicPath } from '@shared/auth/publicPaths'

/**
 * gp-api answers 401 on a route that needs a session when the request carried
 * none — the `/api` rewrite mints the Bearer from the Clerk session, so with the
 * session gone (ended in another tab, or expired) it forwards the request
 * headerless. Nothing used to act on that: each query retried, reported the
 * FetchError to Faro and left the user on a page that could not load. Reported
 * as ENG-11674, where one ended session produced 76 tokenless requests across 14
 * endpoints from a single page load.
 *
 * So this is the one place that turns a missing session into the outcome the
 * middleware already gives a document: one sign-in, with the current path to
 * come back to.
 *
 * Only a bare `Unauthorized` counts, which is what the guards throw when a
 * request has no session. A few routes also 401 with a live session and say why
 * in the message — a wrong current password on `PUT /v1/users/:id/password`
 * ('Invalid password'), a campaign id that does not match — and sending a
 * signed-in user to `/login` for one of those would throw away what they were
 * doing. An unrecognised message therefore stays with the caller, as before.
 *
 * A bare one can still come from a live session: the guard also throws it when a
 * Bearer was sent but could not be resolved (a Clerk user with no email, for
 * instance), and `/login` sends a signed-in user straight back to the page. That
 * would reload the page forever, so a tab asks for a sign-in at most once a
 * minute — the second time it stays where it is, which is what it did before
 * this change.
 *
 * A public page is never redirected: a visitor with no account asking an
 * authenticated question there (the sign-up page checking `/v1/users/me`) is
 * normal, and navigating them would replace the page they came for — which is
 * exactly what broke the sign-up E2E on the first draft of this change.
 */
const UNAUTHORIZED_STATUS = 401
const NO_SESSION_MESSAGE = 'Unauthorized'
const SIGN_IN_PATH = '/login'
const SIGN_IN_REQUESTED_AT_KEY = 'gp-sign-in-requested-at'
const SIGN_IN_COOLDOWN_MS = 60_000
const responseStatus = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } } | null)?.response?.status

const responseMessage = (error: unknown): unknown =>
  (error as { data?: { message?: unknown } } | null)?.data?.message

export const isUnauthorizedError = (error: unknown): boolean =>
  responseStatus(error) === UNAUTHORIZED_STATUS

export const isMissingSessionError = (error: unknown): boolean =>
  isUnauthorizedError(error) && responseMessage(error) === NO_SESSION_MESSAGE

/**
 * One navigation per page load: a page mounts a dozen queries at once and all of
 * them fail together, and none of the later ones has anything to add.
 */
let signingIn = false

/**
 * `sessionStorage` rather than the flag above, because the loop this guards
 * against goes through `/login` and back as a full page load, which resets
 * module state. Storage access throws where a browser blocks it; a tab that
 * cannot remember has simply not been redirected yet.
 */
const askedToSignInRecently = (now: number): boolean => {
  try {
    const requestedAt = Number(
      window.sessionStorage.getItem(SIGN_IN_REQUESTED_AT_KEY),
    )
    return now - requestedAt < SIGN_IN_COOLDOWN_MS
  } catch {
    return false
  }
}

const rememberSignInRequest = (now: number): void => {
  try {
    window.sessionStorage.setItem(SIGN_IN_REQUESTED_AT_KEY, String(now))
  } catch {
    // Blocked storage: the redirect still helps this load.
  }
}

export const requestSignIn = (): void => {
  if (signingIn || typeof window === 'undefined') return

  const { pathname, search } = window.location
  // Already on the sign-in page, or on one that takes visitors with no session:
  // nothing to redirect to, and redirecting from here would loop.
  if (pathname.startsWith(SIGN_IN_PATH) || isPublicPath(pathname)) return

  const now = Date.now()
  if (askedToSignInRecently(now)) return

  signingIn = true
  rememberSignInRequest(now)

  const returnTo = `${pathname}${search}`
  const redirectUrl = isSafeInternalPath(returnTo)
    ? `${SIGN_IN_PATH}?redirect_url=${encodeURIComponent(returnTo)}`
    : SIGN_IN_PATH
  window.location.assign(redirectUrl)
}

/**
 * Test seam: the once-per-page-load flag is module state, so a test that wants
 * a fresh navigation has to reset it.
 */
export const resetSignInRequestForTests = (): void => {
  signingIn = false
}

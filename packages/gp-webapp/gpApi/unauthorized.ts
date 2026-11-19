import { isSafeInternalPath } from 'helpers/isSafeInternalPath'

/**
 * gp-api answers 401 on a route that needs a session only when the request
 * carried none — the `/api` rewrite mints the Bearer from the Clerk session, so
 * a 401 means the tab's session is gone (ended in another tab, or expired)
 * rather than that the request was wrong. Nothing used to act on that: each
 * query retried, reported the FetchError to Faro and left the user on a page
 * that could not load. Reported as ENG-11674, where one ended session produced
 * 76 tokenless requests across 14 endpoints from a single page load.
 *
 * So this is the one place that turns a 401 into the outcome the middleware
 * already gives a document: one sign-in, with the current path to come back to.
 */
const UNAUTHORIZED_STATUS = 401
const SIGN_IN_PATH = '/login'

export const isUnauthorizedError = (error: unknown): boolean => {
  const status = (error as { response?: { status?: number } } | null)?.response
    ?.status
  return status === UNAUTHORIZED_STATUS
}

/**
 * One navigation per page load: a page mounts a dozen queries at once and all of
 * them 401 together, and none of the later ones has anything to add.
 */
let signingIn = false

export const requestSignIn = (): void => {
  if (signingIn || typeof window === 'undefined') return

  const { pathname, search } = window.location
  // Already on the sign-in page: nothing to redirect to, and redirecting from
  // here would loop.
  if (pathname.startsWith(SIGN_IN_PATH)) return

  signingIn = true

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

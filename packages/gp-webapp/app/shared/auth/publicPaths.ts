/**
 * Routes the middleware serves to a visitor with no session, as path prefixes.
 *
 * `middleware.ts` builds its Clerk route matcher from these, and
 * `gpApi/unauthorized.ts` uses the same list for the opposite question: a 401 on
 * a public page is a signed-out visitor asking an authenticated question (the
 * sign-up page checking `/v1/users/me`), which is normal and must not navigate
 * them anywhere. Only on a page that requires a session does a 401 mean the
 * tab's session is gone (ENG-11674).
 *
 * A prefix matches itself and its children, never a longer sibling (`/dev` does
 * not make `/developers` public). `'/'` is not here: it is matched exactly, so
 * the matcher adds it on its own.
 */
export const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/logout',
  '/sign-up',
  '/impersonate',
  // Dev-only local briefing gallery. Both the page and its API route hard-return
  // 404 when NODE_ENV !== 'development', so they never exist in dev/prod.
  '/dev',
  '/api/dev',
  // Magic-link redemption: the lead is not yet authenticated when they land
  // here; the ticket is redeemed client-side. Only /serve/welcome is public —
  // the rest of /serve (e.g. onboarding) still requires an active session.
  '/serve/welcome',
  // Candidate ("win") magic-link redemption — same client-side ticket flow.
  '/win/welcome',
  // Staff-issued one-time sign-in link: the recipient is not yet authenticated
  // when they land here; the ticket is redeemed client-side on click.
  '/sign-in-link',
  // Team-invite landing page (ENG-11027): Clerk's hosted accept URL redirects
  // here with __clerk_ticket, and a brand-new invitee has no session yet.
  '/team-invite',
  // Unsubscribe and reply-address confirmation pages, opened from outreach
  // email by people with no account.
  '/email',
  // Machine endpoint, gated by its own REVALIDATE_SECRET.
  '/api/revalidate',
] as const

/** The Clerk route matcher's spelling of a prefix. */
export const publicPathMatcher = (prefix: string): string => `${prefix}(/.*)?`

export const isPublicPath = (pathname: string): boolean =>
  pathname === '/' ||
  PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )

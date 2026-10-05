import { NON_DASHBOARD_ROUTE_PREFIXES } from '@shared/utils/dashboardRoutes'

/**
 * Route prefixes that make up the elected-official "serve" experience. These
 * pages are gated by `serveAccess` and are scoped to the org that owns the
 * user's elected office, so the post-auth flow must select that org (not the
 * default first org) when landing a user on any of them.
 */
export const SERVE_ROUTE_PREFIXES = [
  '/chief-of-staff',
  '/briefings',
  '/polls',
  '/ordinances',
  '/priorities',
  // Staff briefing review (impersonation) — scoped to the same elected-office
  // org, and reached via a deep link from gp-admin that must survive the
  // post-auth org switch.
  '/community-issues',
  '/public-profile',
  '/constituent-outreach',
  '/admin-review/briefings',
  // Elected-official onboarding. NOTE: the public /serve/welcome magic-link
  // redemption page is intentionally NOT listed — it is reached pre-auth and
  // must not trigger the post-auth elected-office org-slug switch.
  '/serve/onboarding',
] as const

export const isServeRoutePath = (path: string): boolean => {
  // Match on the pathname only — callers may pass a value that still carries a
  // query string or hash (e.g. `/polls?tab=open`).
  const pathname = path.split(/[?#]/)[0] ?? path
  // /polls is shared with app/polls (the polls onboarding outside the
  // dashboard), which must not trigger the elected-office org switch.
  if (
    NON_DASHBOARD_ROUTE_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return false
  }
  return SERVE_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

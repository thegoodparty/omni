// The signed-in app lives in the app/(dashboard) route group, which adds no URL
// segment, so its pages sit at the root beside the routes outside the group
// (/login, /onboarding, /serve). There is no shared prefix to match on any
// more; this list is it. dashboardRoutes.test.ts fails when it drifts from the
// folders.
export const DASHBOARD_ROUTE_SEGMENTS = [
  'account',
  'admin-review',
  'briefings',
  'campaign-details',
  'campaign-plan',
  'campaign-story',
  'campaign-verification',
  'chief-of-staff',
  'community-issues',
  'constituent-outreach',
  'contacts',
  'door-knocking',
  'election-result',
  'home',
  'ordinances',
  'outreach',
  'polls',
  'priorities',
  'pro-upgrade',
  'profile',
  'public-profile',
  'purchase',
  'questions',
  'race',
  'race-opponent',
  'team',
  'website',
] as const

// Routes outside the group that share a first segment with one inside it:
// app/polls is the Serve polls onboarding, which runs before the user has an
// organization, while app/(dashboard)/polls is the polls themselves.
export const NON_DASHBOARD_ROUTE_PREFIXES = [
  '/polls/onboarding',
  '/polls/welcome',
] as const

const matchesPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

export const isDashboardRoute = (
  pathname: string | null | undefined,
): boolean => {
  if (!pathname) return false
  const path = pathname.split(/[?#]/)[0] ?? pathname
  if (NON_DASHBOARD_ROUTE_PREFIXES.some((p) => matchesPrefix(path, p))) {
    return false
  }
  const segment = path.split('/')[1] ?? ''
  return (DASHBOARD_ROUTE_SEGMENTS as readonly string[]).includes(segment)
}

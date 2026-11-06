import type { Organization } from 'gpApi/api-endpoints'

/**
 * The one rule for "which organization is this user in".
 *
 * Extracted from the org-slug hook so the impersonation hand-off can apply the
 * same rule the provider will apply a moment later, rather than restating it.
 * Kept free of `document.cookie`, `next/headers` and `'use client'` — the
 * caller supplies the cookie's value — so a server component can share it too
 * if the server-side half of this ever needs the rule; today none does, and
 * every server read of the org still goes straight through the cookie.
 *
 * A valid cookie wins: it is the user's own pick from the org switcher. "Valid"
 * means the user can see the org AND it can serve a route (see `isUsable`); a
 * stale slug for an org with no Campaign and no held office must not win. Which org leads the list otherwise is
 * gp-api's call (`listOrganizations`), not this function's.
 */
// An org the session can actually work in: it holds a Campaign, or it is an
// elected office the user holds today. A past office with no campaign serves
// no route (campaign-scoped gp-api routes 404 "User has no campaign" there),
// so it must not pin the session (ENG-11606).
const isUsable = (o: Organization): boolean =>
  o.campaignId !== null || (o.electedOfficeId !== null && o.status === 'active')

export const resolveOrgSlug = (
  organizations: Organization[],
  cookieSlug: string | null | false,
): string | null => {
  const fromCookie = cookieSlug
    ? organizations.find((o) => o.slug === cookieSlug)
    : undefined
  if (fromCookie && isUsable(fromCookie)) return fromCookie.slug
  // gp-api's order leads; only skip orgs that cannot serve anything. If none
  // can, keep the old behaviour rather than return null.
  const fallback = organizations.find(isUsable) ?? organizations[0]
  return fallback?.slug ?? null
}

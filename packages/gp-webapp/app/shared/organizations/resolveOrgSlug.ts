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
 * A valid cookie always wins: it is the user's own pick from the org switcher,
 * and nothing here may override it. Which org leads the list otherwise is
 * gp-api's call (`listOrganizations`), not this function's.
 */
export const resolveOrgSlug = (
  organizations: Organization[],
  cookieSlug: string | null | false,
): string | null => {
  const isValid = cookieSlug && organizations.some((o) => o.slug === cookieSlug)
  return isValid ? (cookieSlug as string) : (organizations[0]?.slug ?? null)
}

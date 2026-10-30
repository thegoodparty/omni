import { cache } from 'react'
import { serverRequest } from 'gpApi/server-request'
import type { Organization } from 'gpApi/api-endpoints'

/**
 * Request-scoped fetch of the signed-in user's organizations.
 * Dedupes with React `cache()` when multiple server components call it in the same render.
 */
export const getCurrentUserOrganizations = cache(
  async (): Promise<Organization[]> => {
    const resp = await serverRequest(
      'GET /v1/organizations',
      {},
      { ignoreResponseError: true },
    )
    return resp.ok ? resp.data.organizations : []
  },
)

/**
 * Like getCurrentUserOrganizations, but a failed request throws instead of
 * reading as "no organizations". Use where an empty list triggers a
 * destructive/onboarding redirect: a transient API failure must not be
 * mistaken for a brand-new user (ENG-11531).
 */
export const getCurrentUserOrganizationsOrThrow = cache(
  async (): Promise<Organization[]> => {
    const resp = await serverRequest(
      'GET /v1/organizations',
      {},
      { ignoreResponseError: true },
    )
    if (!resp.ok) {
      throw new Error(`GET /v1/organizations failed (${resp.status})`)
    }
    return resp.data.organizations
  },
)

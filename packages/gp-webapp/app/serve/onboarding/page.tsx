import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { serverRequest } from 'gpApi/server-request'
import type { ElectedOffice } from 'gpApi/api-endpoints'
import { getCurrentUserOrganizations } from 'helpers/getCurrentUserOrganizations'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { requireAuth } from 'helpers/authHelper'
import { SERVE_ONBOARDING_PATH } from 'helpers/resolvePostAuthRedirectPath.util'
import ServeOnboardingFlow from './ServeOnboardingFlow'

/**
 * Server guard for the serve onboarding flow:
 *  - Require auth (sales-sent magic link redeems before landing here).
 *  - Pin the elected-office org slug cookie so every `clientRequest` inside the
 *    flow resolves the EO (the elected-office endpoints resolve by the selected
 *    org's X-Organization-Slug). If the user owns an EO org that isn't the
 *    active slug, route through /post-auth-redirect to switch it and return —
 *    the same trick as `serveAccess`.
 *  - If onboarding is already complete, send them to the Chief of Staff home
 *    (the default Serve landing) instead of re-running onboarding.
 */
export default async function ServeOnboardingPage(): Promise<React.JSX.Element> {
  await requireAuth()

  const currentRes = await serverRequest(
    'GET /v1/elected-office/current',
    {},
    { ignoreResponseError: true },
  )

  if (currentRes.ok) {
    const eo = currentRes.data as ElectedOffice
    if (eo.onboardingCompletedAt) {
      redirect('/dashboard/chief-of-staff')
    }
  } else {
    // The EO org isn't the active org (e.g. a logged-in user with a campaign
    // org selected opened the onboarding link). If they own one, switch to it
    // via post-auth-redirect and come back; otherwise fall through and let the
    // client flow create the EO.
    const [organizations, cookieStore] = await Promise.all([
      getCurrentUserOrganizations(),
      cookies(),
    ])
    const currentSlug = cookieStore.get(ORG_SLUG_COOKIE)?.value
    const electedOfficeOrg = organizations.find((org) => org.electedOfficeId)
    if (electedOfficeOrg && electedOfficeOrg.slug !== currentSlug) {
      redirect(
        `/post-auth-redirect?next=${encodeURIComponent(SERVE_ONBOARDING_PATH)}`,
      )
    }
  }

  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <LoaderCircle className="animate-spin" />
        </div>
      }
    >
      <ServeOnboardingFlow />
    </Suspense>
  )
}

import { auth } from '@clerk/nextjs/server'
import { headers } from 'next/headers'
import { redirect, unstable_rethrow } from 'next/navigation'
import { apiRoutes } from 'gpApi/routes'
import { serverFetch } from 'gpApi/serverFetch'
import { getCurrentUserOrganizations } from 'helpers/getCurrentUserOrganizations'
import { getServerUser } from 'helpers/userServerHelper'
import {
  resolvePostAuthRedirectPath,
  CampaignStatus,
} from 'helpers/resolvePostAuthRedirectPath.util'

export async function fetchCampaignStatus(): Promise<CampaignStatus> {
  try {
    const resp = await serverFetch<CampaignStatus>(apiRoutes.campaign.status)
    if (resp.status === 498) {
      redirect('/logout')
    }
    return resp.data
  } catch (e) {
    unstable_rethrow(e)
    console.log('error at fetchCampaignStatus', e)
    return { status: false }
  }
}

const fetchHasCurrentElectedOffice = async (): Promise<boolean> => {
  try {
    const resp = await serverFetch(apiRoutes.electedOffice.current)
    return resp.ok
  } catch {
    return false
  }
}

const fetchMyElectedOffices = async (): Promise<
  { onboardingCompletedAt: string | null }[]
> => {
  try {
    const resp = await serverFetch(apiRoutes.electedOffice.mine)
    return resp.ok && Array.isArray(resp.data) ? resp.data : []
  } catch {
    return []
  }
}

const fetchHasElectedOfficeOrg = async (): Promise<boolean> => {
  try {
    const organizations = await getCurrentUserOrganizations()
    return organizations.some((o) => o.electedOfficeId)
  } catch {
    return false
  }
}

export async function getPostAuthRedirectPath(): Promise<string> {
  const [user, campaignStatus, hasCurrentEO, myElectedOffices, hasEoOrg] =
    await Promise.all([
      getServerUser(),
      fetchCampaignStatus(),
      fetchHasCurrentElectedOffice(),
      fetchMyElectedOffices(),
      fetchHasElectedOfficeOrg(),
    ])

  // Mirror the OTP /post-auth-redirect path: `/current` only resolves the
  // active-slug org's office (404s behind a campaign org), so scan every office
  // the user holds. An incomplete office routes the user into serve onboarding
  // from every entry point (/, /login, /sign-up), not just the OTP flow.
  const incompleteEO = myElectedOffices.find((eo) => !eo.onboardingCompletedAt)
  const relevantEO = incompleteEO ?? myElectedOffices[0] ?? null
  // Also honor an org that owns an elected office even when both EO endpoints
  // miss (e.g. a provisioning race), matching the OTP page's `!!electedOrg`.
  const hasElectedOffice =
    hasCurrentEO || myElectedOffices.length > 0 || hasEoOrg
  // Default to "complete" when no concrete EO record resolves so a legacy
  // win→serve user isn't looped back into /serve/onboarding on every login.
  const electedOfficeOnboardingComplete = relevantEO
    ? !!relevantEO.onboardingCompletedAt
    : true

  return resolvePostAuthRedirectPath(
    user,
    campaignStatus,
    hasElectedOffice,
    electedOfficeOnboardingComplete,
  )
}

export default async function candidateAccess(): Promise<void> {
  const { userId, actor } = await auth()

  if (!userId) {
    return redirect('/sign-up')
  }

  // `candidateAccess` is also used by non-dashboard routes (e.g. `/polls/*`); only
  // bounce orgless users away from `/dashboard` where the UI assumes an organization.
  const pathname = (await headers()).get('x-pathname') ?? ''
  if (pathname.startsWith('/dashboard')) {
    const organizations = await getCurrentUserOrganizations()
    if (organizations.length === 0) {
      return redirect('/onboarding/office-selection')
    }
  }

  // Skip the legacy token check for impersonated sessions — actor tokens are Clerk JWTs
  // and won't have the legacy cookie that fetchCampaignStatus checks for (which would
  // return 498 and incorrectly sign out the session).
  // don't remove this call for non-impersonated users. It prevents the build process
  // from trying to cache this page which should be dynamic
  // https://nextjs.org/docs/messages/dynamic-server-error
  if (!actor) {
    await fetchCampaignStatus()
  }
}

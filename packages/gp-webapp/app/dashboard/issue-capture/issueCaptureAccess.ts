import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import { getFlagVariants } from '@shared/experiments/getFlagVariants'
import { SERVE_ISSUE_CAPTURE_FLAG_KEY } from '@shared/experiments/serveIssueCaptureFlag'
import { WIN_ISSUE_CAPTURE_FLAG_KEY } from '@shared/experiments/winIssueCaptureFlag'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'

// What every page here checks before it renders. `candidateAccess` is the
// gate the phone caller uses for both products: signed in, in an org, and
// not a volunteer, whose report this is not. Then the product's own flag,
// chosen by the org's slug the way gp-api's `issueCaptureFlagFor` chooses
// it, so the page and its routes roll out together. A flag-off visit leaves
// for the dashboard before anything of the feature renders.
//
// Returns which product's words the page speaks.
export const issueCaptureAccess = async (): Promise<{ isServe: boolean }> => {
  await candidateAccess()
  const [variants, cookieStore] = await Promise.all([
    getFlagVariants(),
    cookies(),
  ])
  const isServe =
    cookieStore.get(ORG_SLUG_COOKIE)?.value.startsWith('eo-') === true
  const flagKey = isServe
    ? SERVE_ISSUE_CAPTURE_FLAG_KEY
    : WIN_ISSUE_CAPTURE_FLAG_KEY
  if (variants?.[flagKey]?.value !== 'on') redirect('/dashboard')
  return { isServe }
}

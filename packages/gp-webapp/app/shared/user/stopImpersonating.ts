import { clearElectionResultDismissed } from 'app/dashboard/election-result/dismissal'
import { deleteCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'

const GP_ADMIN_URL = process.env.NEXT_PUBLIC_GP_ADMIN_URL ?? '/'

// Ends the impersonation session and returns the staff member to gp-admin,
// honoring the return path stashed by the /impersonate entry flow.
export const stopImpersonatingAndReturnToAdmin = async (
  signOut: () => Promise<void>,
): Promise<void> => {
  await signOut()
  clearElectionResultDismissed()
  // Drop the impersonated user's org selection so it can't be carried into the
  // staff member's own next visit to the webapp (the cookie outlives the Clerk
  // session by months). Cleared rather than restored: their own session sets it
  // again on the way through /post-auth-redirect at next sign-in.
  deleteCookie(ORG_SLUG_COOKIE)
  let returnPath = '/'
  try {
    returnPath = sessionStorage.getItem('gp_admin_return_to') ?? '/'
    sessionStorage.removeItem('gp_admin_return_to')
  } catch {
    returnPath = '/'
  }
  window.location.href = GP_ADMIN_URL + returnPath
}

import { clearElectionResultDismissed } from 'app/dashboard/election-result/dismissal'

const GP_ADMIN_URL = process.env.NEXT_PUBLIC_GP_ADMIN_URL ?? '/'

// Ends the impersonation session and returns the staff member to gp-admin,
// honoring the return path stashed by the /impersonate entry flow.
export const stopImpersonatingAndReturnToAdmin = async (
  signOut: () => Promise<void>,
): Promise<void> => {
  await signOut()
  clearElectionResultDismissed()
  let returnPath = '/'
  try {
    returnPath = sessionStorage.getItem('gp_admin_return_to') ?? '/'
    sessionStorage.removeItem('gp_admin_return_to')
  } catch {
    returnPath = '/'
  }
  window.location.href = GP_ADMIN_URL + returnPath
}

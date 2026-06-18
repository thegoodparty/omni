// Lets an impersonating admin dismiss the forced "Did you win?" gate without
// answering it (answering mutates the candidate's account). Scoped to
// sessionStorage so it only suppresses the redirect for the current
// impersonation session — a real, non-impersonated user still sees the gate.
const DISMISSED_KEY = 'gp:electionResultDismissedDuringImpersonation'

export const dismissElectionResult = (): void => {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(DISMISSED_KEY, 'true')
}

export const isElectionResultDismissed = (): boolean => {
  if (typeof window === 'undefined') return false
  return window.sessionStorage.getItem(DISMISSED_KEY) === 'true'
}

// sessionStorage survives same-tab impersonation transitions, so the flag must
// be cleared at every impersonation boundary (start, switch, stop) — otherwise
// a candidate impersonated later in the same tab inherits the prior dismissal
// and never sees their own gate.
export const clearElectionResultDismissed = (): void => {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(DISMISSED_KEY)
}

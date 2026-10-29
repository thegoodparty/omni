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

// "Results aren't final yet" hides the question, on the page and in the
// campaign manager chat, for 3 days. Kept in localStorage like the manager's
// meet card: it is a nudge, so a new browser asking again early is fine.
// Keyed to the campaign so another campaign on the same browser is still
// asked.
const SNOOZE_KEY = 'gp:electionResultSnoozedUntil'
export const ELECTION_RESULT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000

export const snoozeElectionResult = (
  campaignId: number,
  now: number = Date.now(),
): void => {
  try {
    window.localStorage.setItem(
      SNOOZE_KEY,
      `${campaignId}:${now + ELECTION_RESULT_SNOOZE_MS}`,
    )
  } catch {
    // Storage disabled: the question comes back next load.
  }
}

export const isElectionResultSnoozed = (
  campaignId: number | undefined,
  now: number = Date.now(),
): boolean => {
  if (campaignId === undefined || typeof window === 'undefined') return false
  try {
    const [id, until] = (window.localStorage.getItem(SNOOZE_KEY) ?? '').split(
      ':',
    )
    return id === String(campaignId) && Number(until) > now
  } catch {
    return false
  }
}

export const clearElectionResultSnooze = (): void => {
  try {
    window.localStorage.removeItem(SNOOZE_KEY)
  } catch {
    // Storage disabled: nothing was saved.
  }
}

// Step-derivation router for the pre-payment Pro upgrade wizard.
//
// Per tech doc v2 there is no server-side wizard session: the current step is
// derived purely from canonical state (campaign.isPro, the candidate's
// filing-status answer, EIN presence, TCR filing + PIN completeness, and
// candidate-profile completeness) so a candidate who leaves and returns lands
// on the correct step. This module must stay pure and side-effect-free — it
// only reads the inputs it is handed.

export const PRO_UPGRADE_STEP = {
  VALUE_PROP: 'value-prop',
  STATUS: 'status',
  FILING_INSTRUCTIONS: 'filing-instructions',
  GUIDANCE: 'guidance',
  EIN: 'ein',
  FILING_DETAILS: 'filing-details',
  CANDIDATE_PROFILE: 'candidate-profile',
  PAYMENT: 'payment',
  SUCCESS: 'success',
} as const

export type ProUpgradeStep =
  (typeof PRO_UPGRADE_STEP)[keyof typeof PRO_UPGRADE_STEP]

export const PRO_UPGRADE_BASE_PATH = '/dashboard/pro-upgrade'

// ?src=outreach swaps the wizard chrome for the Voter Outreach 2.0 takeover
// (see ProUpgradeWizard). Navigation helpers pass the current src through so
// the fork survives every in-wizard step change.
export const PRO_UPGRADE_TAKEOVER_SRC = 'outreach'

export const proUpgradeStepPath = (
  step: ProUpgradeStep,
  src?: string | null,
): string =>
  `${PRO_UPGRADE_BASE_PATH}/${step}${src ? `?src=${encodeURIComponent(src)}` : ''}`

// Linear forward-navigation order for the wizard shell's Back/Next controls.
// Every entry is a step `deriveProUpgradeStep` can actually land on, so the
// progress bar and nav stay in sync with the router.
//
// Two steps are intentionally absent:
// - `filing-instructions`: a dead-end branch off `status` (the candidate has
//   not yet filed to run), not a resumable step in the linear flow.
// - `guidance`: an interstitial with no persisted "seen" state, so the router
//   cannot derive it. It is reached only by explicit navigation from the
//   filing-status step ("yes, already filed" → guidance) and advances by
//   explicit navigation to the EIN step (task 09), so it stays out of the
//   linear order by design rather than being inserted here.
export const PRO_UPGRADE_STEP_ORDER: ProUpgradeStep[] = [
  PRO_UPGRADE_STEP.VALUE_PROP,
  PRO_UPGRADE_STEP.STATUS,
  PRO_UPGRADE_STEP.EIN,
  PRO_UPGRADE_STEP.FILING_DETAILS,
  PRO_UPGRADE_STEP.CANDIDATE_PROFILE,
  PRO_UPGRADE_STEP.PAYMENT,
  PRO_UPGRADE_STEP.SUCCESS,
]

// The candidate's answer to "have you already filed to run for this office?".
// The router only needs the normalized tri-state; its caller maps the stored
// value into this. `unanswered` means the question has not been answered yet.
export type FilingStatus = 'unanswered' | 'has-filed' | 'not-filed'

// The answer is persisted as `campaign.details.hasFiledForRace` (task 07).
// This is the single mapping the wizard index (read) and the filing-status
// step (write) share, so a candidate who answered "yes" is never re-asked on
// return. An unset value (never answered) is `unanswered`.
export const filingStatusFromDetails = (
  hasFiledForRace: boolean | null | undefined,
): FilingStatus => {
  if (hasFiledForRace === true) return 'has-filed'
  if (hasFiledForRace === false) return 'not-filed'
  return 'unanswered'
}

export interface ProUpgradeStepInputs {
  isPro: boolean
  filingStatus: FilingStatus
  hasEin: boolean
  filingComplete: boolean
  profileComplete: boolean
  // Whether TCR PIN verification has happened. Not used to gate any
  // pre-payment step (PIN entry is a post-payment concern); carried here so
  // the post-payment status states (task 15) can refine the SUCCESS surface
  // without changing this contract.
  pinComplete: boolean
}

/**
 * Returns the step the candidate should land on, derived from canonical state.
 *
 * Already-Pro candidates are routed to the post-payment SUCCESS surface and
 * never back to a pre-payment step. Otherwise the first incomplete step in
 * canonical order wins, so completed prerequisites are skipped on return (e.g.
 * a candidate with a complete profile but no EIN lands on the EIN step).
 */
export const deriveProUpgradeStep = (
  inputs: ProUpgradeStepInputs,
): ProUpgradeStep => {
  const { isPro, filingStatus, hasEin, filingComplete, profileComplete } =
    inputs

  // Payment already happened — route to the post-payment surface, never back
  // to a pre-payment step. (Post-payment sub-states are refined in task 15.)
  if (isPro) return PRO_UPGRADE_STEP.SUCCESS

  // Brand-new candidate with nothing collected yet lands on the value-prop
  // intro. A "not filed" answer is NOT progress: on its own it must restart a
  // returning candidate at the value prop, never strand them on the
  // filing-instructions dead-end (ENG-10372). An "already filed" answer counts
  // as progress so a returning filed candidate resumes at the EIN step instead
  // of being re-asked the filing-status question (task 07).
  const hasProgress =
    filingStatus === 'has-filed' || hasEin || filingComplete || profileComplete
  if (!hasProgress) return PRO_UPGRADE_STEP.VALUE_PROP

  // Filing-status gate (task 07): ask if still unanswered. "Not filed" is never
  // resumed here — filing-instructions is a dead-end branch reached only by
  // explicit navigation from the status step (like guidance), so the router
  // does not derive it. A not-filed candidate with real downstream progress
  // resumes at that data step below.
  if (filingStatus === 'unanswered') return PRO_UPGRADE_STEP.STATUS

  // Remaining pre-payment data steps, in canonical order; first incomplete wins.
  if (!hasEin) return PRO_UPGRADE_STEP.EIN
  if (!filingComplete) return PRO_UPGRADE_STEP.FILING_DETAILS
  if (!profileComplete) return PRO_UPGRADE_STEP.CANDIDATE_PROFILE

  // Everything collected, not yet Pro → payment.
  return PRO_UPGRADE_STEP.PAYMENT
}

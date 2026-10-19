// Step-derivation router for the pre-payment Pro upgrade wizard.
//
// Per tech doc v2 there is no server-side wizard session: the current step is
// derived purely from canonical state (campaign.isPro) so a candidate who
// leaves and returns lands on the correct step. This module must stay pure and side-effect-free — it
// only reads the inputs it is handed.

export const PRO_UPGRADE_STEP = {
  STATUS: 'status',
  FILING_INSTRUCTIONS: 'filing-instructions',
  GUIDANCE: 'guidance',
  EIN: 'ein',
  FILING_DETAILS: 'filing-details',
  PAYMENT: 'payment',
  SUCCESS: 'success',
  // Milestone 2: the "your first {noun} has been made" pause screen an
  // outreach flow lands on before this wizard. It has no route and no
  // persisted "seen" state, so — unlike GUIDANCE — it is never derived and
  // never added to the linear order; a caller can only reach it by
  // passing it as ProUpgradeFlow's `initialStep`.
  INTERSTITIAL: 'interstitial',
} as const

export type ProUpgradeStep =
  (typeof PRO_UPGRADE_STEP)[keyof typeof PRO_UPGRADE_STEP]

export const PRO_UPGRADE_BASE_PATH = '/dashboard/pro-upgrade'

export const proUpgradeStepPath = (step: ProUpgradeStep): string =>
  `${PRO_UPGRADE_BASE_PATH}/${step}`

// Linear forward-navigation order for the wizard shell's Back/Next controls.
// Guidance is the first step and the router derives it. Filing details stay
// before payment, in campaign verification's form, because candidates who were
// asked for them after paying rarely came back to submit them.
//
// `filing-instructions` is intentionally absent: a dead-end branch off
// `status` (the candidate has not yet filed to run), not a resumable step in
// the linear flow.
export const PRO_UPGRADE_STEP_ORDER: ProUpgradeStep[] = [
  PRO_UPGRADE_STEP.GUIDANCE,
  PRO_UPGRADE_STEP.STATUS,
  PRO_UPGRADE_STEP.EIN,
  PRO_UPGRADE_STEP.FILING_DETAILS,
  PRO_UPGRADE_STEP.PAYMENT,
  PRO_UPGRADE_STEP.SUCCESS,
]

export interface ProUpgradeStepInputs {
  isPro: boolean
}

/**
 * Returns the step the candidate should land on, derived from canonical state.
 *
 * Already-Pro candidates are routed to the post-payment SUCCESS surface and
 * never back to a pre-payment step. Everyone else opens on guidance (design:
 * sgOpen starts at the overview), the same way the outreach sheet's embedded
 * flow does. The steps prefill from what is saved — the filing answer, the
 * EIN, a submitted filing — so a returning candidate walks prefilled screens
 * rather than being dropped onto Payment by a resume they cannot see the
 * reason for.
 */
export const deriveProUpgradeStep = ({
  isPro,
}: ProUpgradeStepInputs): ProUpgradeStep =>
  isPro ? PRO_UPGRADE_STEP.SUCCESS : PRO_UPGRADE_STEP.GUIDANCE

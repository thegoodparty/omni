// The list details drawer's footer, as the Voter Outreach 2.0 canvas defines
// it (`CampaignDetailsDrawer`'s `footerMode` in the prototype). Four modes,
// one per thing a candidate can do about a campaign at the moment they open
// it, and the vocabulary lives here rather than in either drawer so the two
// surfaces cannot word the same action differently.
//
// The second input is `selfServe` — "is there something this candidate can do
// about this campaign from here". The canvas hardcodes `edit` for a scheduled
// campaign because every prototype row is a mock with an editable copy behind
// it; ours are not. A scheduled legacy text or robocall campaign has been paid
// for and is sent by Peerly, with no edit and no delete endpoint anywhere, so
// asking it for the `edit` mode would put two buttons on screen that cannot
// work. `automatic` — the canvas's own words for a campaign that needs nothing
// from you — is the true answer for those, and `edit` lands where it is real:
// a saved door-knocking list that has not been knocked yet, which has both a
// PUT and a DELETE behind it.
export type ListDetailsLifecycle = 'scheduled' | 'in_progress' | 'done'

export type ListDetailsFooterMode =
  | 'edit'
  | 'continue'
  | 'automatic'
  | 'done'
  | 'none'

export const listDetailsFooterMode = (
  lifecycle: ListDetailsLifecycle | null,
  selfServe: boolean,
): ListDetailsFooterMode => {
  if (lifecycle === null) return 'none'
  if (lifecycle === 'done') return 'done'
  if (!selfServe) return 'automatic'
  return lifecycle === 'scheduled' ? 'edit' : 'continue'
}

// Canvas copy, verbatim. The two continue labels are one map rather than two
// strings so a third drivable channel cannot invent a third verb.
export const CONTINUE_LABELS = {
  phoneBanking: 'Continue calling',
  doorKnocking: 'Continue knocking',
} as const

export const AUTOMATIC_NOTE =
  'This campaign is sending automatically. No action needed.'

// `Show post` is the canvas's own exception for social, where there is no
// results surface to open — it renders the button disabled rather than
// dropping it, so the row keeps its shape across channels.
export const SHOW_RESULTS_LABEL = 'Show results'
export const SHOW_POST_LABEL = 'Show post'

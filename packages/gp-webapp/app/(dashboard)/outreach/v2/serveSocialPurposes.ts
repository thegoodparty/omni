import {
  SERVE_SOCIAL_PURPOSE_VALUES,
  type ServeSocialPurpose,
} from '@goodparty_org/contracts'

// Contract slugs → the design's card copy. The API stores slugs; display
// labels are the webapp's job. Serve's own vocabulary (constituent framing,
// no election mechanics) — see socialPurposes.ts for the Win equivalent.
export const SERVE_SOCIAL_PURPOSE_LABELS: Record<ServeSocialPurpose, string> = {
  introduce_myself: 'Introduce myself',
  explain_decision: 'Explain a recent decision',
  event_invite: 'Invite people to a local event',
  community_input: 'Ask for community input',
  share_resource: 'Share a resource or service',
  issue_update: 'Share an issue update',
  custom: 'Write my own message',
}

const FALLBACK_NAME = 'Social post'

// Deliberately a second record rather than a derivation of the labels above,
// mirroring socialPurposes.ts: a label is copy on a card, phrased as the
// thing the constituent wants to do ("Invite people to a local event"),
// while a name suggestion is a default title for a campaign in the outreach
// history list ("Event invite posts"). Collapsing them means the next copy
// correction to a card silently renames campaigns.
export const SERVE_SOCIAL_PURPOSE_NAME_SUGGESTIONS: Record<
  ServeSocialPurpose,
  string
> = {
  introduce_myself: 'Introduction posts',
  explain_decision: 'Decision update posts',
  event_invite: 'Event invite posts',
  community_input: 'Community input posts',
  share_resource: 'Resource posts',
  issue_update: 'Issue update posts',
  // The flow suggests nothing for custom; the entry keeps the record total so
  // a new purpose is a compile error here.
  custom: FALLBACK_NAME,
}

export const SERVE_SOCIAL_PURPOSES: {
  id: ServeSocialPurpose
  label: string
}[] = SERVE_SOCIAL_PURPOSE_VALUES.map((id) => ({
  id,
  label: SERVE_SOCIAL_PURPOSE_LABELS[id],
}))

export const serveSocialPurposeLabel = (purpose: string): string =>
  SERVE_SOCIAL_PURPOSE_LABELS[purpose as ServeSocialPurpose] ?? FALLBACK_NAME

export const serveSocialPurposeNameSuggestion = (purpose: string): string =>
  SERVE_SOCIAL_PURPOSE_NAME_SUGGESTIONS[purpose as ServeSocialPurpose] ??
  FALLBACK_NAME

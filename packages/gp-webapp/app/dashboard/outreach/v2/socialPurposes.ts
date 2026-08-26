import {
  SOCIAL_PURPOSE_VALUES,
  type SocialPurpose,
} from '@goodparty_org/contracts'

// Contract slugs → the design's card copy. The API stores slugs; display
// labels are the webapp's job.
export const SOCIAL_PURPOSE_LABELS: Record<SocialPurpose, string> = {
  introduce_myself: 'Introduce myself',
  persuade_voters: 'Persuade likely voters',
  event_invite: 'Invite people to a local event',
  early_voting: 'Encourage early voting',
  election_day_turnout: 'Election day turnout',
  issue_update: 'Share an issue update',
  custom: 'Write my own message',
}

const FALLBACK_NAME = 'Social post'

// Deliberately a second record rather than a derivation of the labels above,
// mirroring phoneBankingPurposes.ts: a label is copy on a card, phrased as the
// thing the candidate wants to do ("Invite people to a local event"), while a
// name suggestion is a default title for a campaign in the outreach history
// list ("Event invite posts"). Collapsing them means the next copy correction
// to a card silently renames campaigns.
export const SOCIAL_PURPOSE_NAME_SUGGESTIONS: Record<SocialPurpose, string> = {
  introduce_myself: 'Introduction posts',
  persuade_voters: 'Persuasion posts',
  event_invite: 'Event invite posts',
  early_voting: 'Early voting posts',
  election_day_turnout: 'Election day posts',
  issue_update: 'Issue update posts',
  // The flow suggests nothing for custom; the entry keeps the record total so
  // a new purpose is a compile error here.
  custom: FALLBACK_NAME,
}

export const SOCIAL_PURPOSES: { id: SocialPurpose; label: string }[] =
  SOCIAL_PURPOSE_VALUES.map((id) => ({
    id,
    label: SOCIAL_PURPOSE_LABELS[id],
  }))

export const socialPurposeLabel = (purpose: string): string =>
  SOCIAL_PURPOSE_LABELS[purpose as SocialPurpose] ?? FALLBACK_NAME

export const socialPurposeNameSuggestion = (purpose: string): string =>
  SOCIAL_PURPOSE_NAME_SUGGESTIONS[purpose as SocialPurpose] ?? FALLBACK_NAME

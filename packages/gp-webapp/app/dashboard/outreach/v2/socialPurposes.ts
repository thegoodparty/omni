import type { SocialPurpose } from '@goodparty_org/contracts'

// Contract slugs → the design's card copy. The API stores slugs; display
// labels are the webapp's job.
//
// Unified across every Win outreach flow (social / SMS / robocall / phone
// banking / door knocking) as the "…voters…" verbose style, differing only
// on `custom` where the noun changes per channel (message / script / list).
// SMS reads these labels directly via SMS_PURPOSES; robocall and phone
// banking own their own records with the same strings.
export const SOCIAL_PURPOSE_LABELS: Record<SocialPurpose, string> = {
  introduce_myself: 'Introduce myself to voters',
  persuade_voters: 'Persuade likely voters',
  event_invite: 'Invite voters to a local event',
  early_voting: 'Encourage early voting',
  election_day_turnout: 'Encourage voters to vote on election day',
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

// Card order for the social step is fixed here rather than read off
// `SOCIAL_PURPOSE_VALUES`: the contracts enum appends `issue_update` after
// `custom`, but the design lists `issue_update` second-to-last with
// `custom` as the final option ("write my own message" reads as the
// escape hatch, and belongs at the bottom of the stack).
const SOCIAL_PURPOSE_ORDER: readonly SocialPurpose[] = [
  'introduce_myself',
  'persuade_voters',
  'event_invite',
  'early_voting',
  'election_day_turnout',
  'issue_update',
  'custom',
]

export const SOCIAL_PURPOSES: { id: SocialPurpose; label: string }[] =
  SOCIAL_PURPOSE_ORDER.map((id) => ({
    id,
    label: SOCIAL_PURPOSE_LABELS[id],
  }))

export const socialPurposeLabel = (purpose: string): string =>
  SOCIAL_PURPOSE_LABELS[purpose as SocialPurpose] ?? FALLBACK_NAME

export const socialPurposeNameSuggestion = (purpose: string): string =>
  SOCIAL_PURPOSE_NAME_SUGGESTIONS[purpose as SocialPurpose] ?? FALLBACK_NAME

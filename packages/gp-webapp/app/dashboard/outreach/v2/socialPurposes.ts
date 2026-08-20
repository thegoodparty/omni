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

export const SOCIAL_PURPOSES: { id: SocialPurpose; label: string }[] =
  SOCIAL_PURPOSE_VALUES.map((id) => ({
    id,
    label: SOCIAL_PURPOSE_LABELS[id],
  }))

export const socialPurposeLabel = (purpose: string): string =>
  SOCIAL_PURPOSE_LABELS[purpose as SocialPurpose] ?? 'Social post'

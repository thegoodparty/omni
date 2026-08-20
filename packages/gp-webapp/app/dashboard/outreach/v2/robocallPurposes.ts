// Robocall purpose slugs → the design's card copy, mirroring socialPurposes.
// Kept local for now; it moves to @goodparty_org/contracts when the AI
// script-draft endpoint (POST /v1/outreach/robocall/draft) lands and needs the
// slug on the wire.
export const ROBOCALL_PURPOSE_VALUES = [
  'introduce_myself',
  'persuade_voters',
  'event_invite',
  'early_voting',
  'election_day_turnout',
  'issue_update',
  'custom',
] as const

export type RobocallPurpose = (typeof ROBOCALL_PURPOSE_VALUES)[number]

export const ROBOCALL_PURPOSE_LABELS: Record<RobocallPurpose, string> = {
  introduce_myself: 'Introduce myself',
  persuade_voters: 'Persuade likely voters',
  event_invite: 'Invite people to a local event',
  early_voting: 'Encourage early voting',
  election_day_turnout: 'Election day turnout',
  issue_update: 'Share an issue update',
  custom: 'Write my own message',
}

export const ROBOCALL_PURPOSES: { id: RobocallPurpose; label: string }[] =
  ROBOCALL_PURPOSE_VALUES.map((id) => ({
    id,
    label: ROBOCALL_PURPOSE_LABELS[id],
  }))

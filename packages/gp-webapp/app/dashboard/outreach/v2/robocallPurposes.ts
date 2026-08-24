// Robocall purpose slugs → the design canvas's card copy. The copy is
// per-channel and is NOT shared with social: robocall says "Introduce myself
// to voters" / "Write my own script", and it has no "Share an issue update"
// card at all.
// Kept local for now; it moves to @goodparty_org/contracts when the AI
// script-draft endpoint (POST /v1/outreach/robocall/draft) lands and needs the
// slug on the wire.
export const ROBOCALL_PURPOSE_VALUES = [
  'introduce_myself',
  'persuade_voters',
  'event_invite',
  'early_voting',
  'election_day_turnout',
  'custom',
] as const

export type RobocallPurpose = (typeof ROBOCALL_PURPOSE_VALUES)[number]

export const ROBOCALL_PURPOSE_LABELS: Record<RobocallPurpose, string> = {
  introduce_myself: 'Introduce myself to voters',
  persuade_voters: 'Persuade likely voters',
  event_invite: 'Invite voters to a local event',
  early_voting: 'Encourage voters to vote early',
  election_day_turnout: 'Encourage voters to vote on election day',
  custom: 'Write my own script',
}

export const ROBOCALL_PURPOSES: { id: RobocallPurpose; label: string }[] =
  ROBOCALL_PURPOSE_VALUES.map((id) => ({
    id,
    label: ROBOCALL_PURPOSE_LABELS[id],
  }))

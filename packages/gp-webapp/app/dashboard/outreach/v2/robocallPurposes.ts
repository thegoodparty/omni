import {
  ROBOCALL_PURPOSE_VALUES,
  type RobocallPurpose,
} from '@goodparty_org/contracts'

// The purpose slugs now live on the wire (POST /v1/outreach/robocall/draft), so
// the canonical enum + type come from contracts. This file owns only the
// per-channel card copy: robocall says "Introduce myself to voters" / "Write my
// own script", and has no "Share an issue update" card.
export { ROBOCALL_PURPOSE_VALUES, type RobocallPurpose }

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

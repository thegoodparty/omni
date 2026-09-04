import {
  OUTREACH_PURPOSE_VALUES,
  type OutreachPurpose,
} from '@goodparty_org/contracts'

// Door knocking used to carry its own six-value purpose vocabulary — local
// rather than a contracts enum, because nothing persisted it and the design
// canvas's own goal cards (issue/introduce/persuade/turnout/event/custom) had
// no equivalent on the other channels. Recommended lists key every universe
// on the shared `OUTREACH_PURPOSE_VALUES` intent vocabulary
// (docs/features/recommended-lists.md), and Task 0 consolidated SMS,
// robocall and phone banking onto it for exactly this reason — a fourth,
// door-knocking-shaped translation table was the thing that consolidation
// existed to avoid. So this step now picks a shared purpose slug directly:
// `DoorKnockingPurpose` is that same type, re-exported under this file's own
// name so the flow and its tests don't need to know it stopped being local.
//
// The old "Discover local issues" card has no equivalent slug and is gone
// with the vocabulary it belonged to; "Turn out my supporters" is now spelled
// `election_day_turnout`, matching what a candidate means by it on every
// other channel.
export type DoorKnockingPurpose = OutreachPurpose

export const DOOR_KNOCKING_PURPOSE_VALUES = OUTREACH_PURPOSE_VALUES

// Unified with the other Win outreach flows' verbose "…voters…" style; the
// only per-channel variance is `custom`, which reads "Build from scratch"
// here because a custom door-knocking is filter-building, not writing text
// (unlike social/SMS's "Write my own message" or robocall/phone-banking's
// "Write my own script").
export const DOOR_KNOCKING_PURPOSE_LABELS: Record<DoorKnockingPurpose, string> =
  {
    introduce_myself: 'Introduce myself to voters',
    persuade_voters: 'Persuade likely voters',
    event_invite: 'Invite voters to a local event',
    early_voting: 'Encourage early voting',
    election_day_turnout: 'Encourage voters to vote on election day',
    custom: 'Build from scratch',
  }

const FALLBACK_NAME = 'Door knocking list'

// Deliberately a third record rather than a derivation of the labels above —
// the #1385 lesson, arrived at by renaming live campaigns. A label is copy on
// a card, phrased as a goal ("Turn out my supporters"); a name suggestion is a
// default title for a saved list in the rail ("Turnout walk"). Collapsing them
// means the next copy correction to a card silently renames lists.
export const DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS: Record<
  DoorKnockingPurpose,
  string
> = {
  introduce_myself: 'Introduction walk',
  persuade_voters: 'Persuasion walk',
  event_invite: 'Event invite walk',
  early_voting: 'Early voting walk',
  election_day_turnout: 'Turnout walk',
  // The flow suggests nothing for custom; the entry keeps the record total so
  // a new purpose is a compile error here.
  custom: FALLBACK_NAME,
}

export const DOOR_KNOCKING_PURPOSES: {
  id: DoorKnockingPurpose
  label: string
}[] = DOOR_KNOCKING_PURPOSE_VALUES.map((id) => ({
  id,
  label: DOOR_KNOCKING_PURPOSE_LABELS[id],
}))

export const doorKnockingPurposeLabel = (purpose: string): string =>
  DOOR_KNOCKING_PURPOSE_LABELS[purpose as DoorKnockingPurpose] ?? FALLBACK_NAME

export const doorKnockingPurposeNameSuggestion = (purpose: string): string =>
  DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS[purpose as DoorKnockingPurpose] ??
  FALLBACK_NAME

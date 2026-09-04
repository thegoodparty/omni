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

// Door knocking's own wording for the shared slugs — deliberately NOT
// social's copy, and not phone banking's either: this channel's goals are
// about a conversation on a doorstep, so the phrasing stays door-knocking's
// own. Robocall and phone banking both shipped with social's labels
// copy-pasted and had to be corrected (#1379) — the correction is cheaper
// than the copy-paste.
export const DOOR_KNOCKING_PURPOSE_LABELS: Record<DoorKnockingPurpose, string> =
  {
    introduce_myself: 'Introduce myself',
    persuade_voters: 'Persuade undecided voters',
    event_invite: 'Invite people to an event',
    early_voting: 'Encourage early voting',
    election_day_turnout: 'Turn out my supporters',
    custom: 'Something else',
  }

// A second line on the card, which phone banking has no equivalent of: a
// door-knocking goal decides how a candidate spends an evening on foot, and
// the one-liner is what separates "persuade" from "turn out" before the who
// step asks them to express the difference in an audience.
export const DOOR_KNOCKING_PURPOSE_DESCRIPTIONS: Record<
  DoorKnockingPurpose,
  string
> = {
  introduce_myself: 'Meet voters who do not know you yet.',
  persuade_voters: 'Talk with voters who could still swing your way.',
  event_invite: 'Promote a town hall or meet and greet.',
  early_voting: 'Remind supporters to vote before election day.',
  election_day_turnout: 'Remind likely supporters to vote.',
  custom: 'Build a list from scratch with your own filters.',
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
  description: string
}[] = DOOR_KNOCKING_PURPOSE_VALUES.map((id) => ({
  id,
  label: DOOR_KNOCKING_PURPOSE_LABELS[id],
  description: DOOR_KNOCKING_PURPOSE_DESCRIPTIONS[id],
}))

export const doorKnockingPurposeLabel = (purpose: string): string =>
  DOOR_KNOCKING_PURPOSE_LABELS[purpose as DoorKnockingPurpose] ?? FALLBACK_NAME

export const doorKnockingPurposeNameSuggestion = (purpose: string): string =>
  DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS[purpose as DoorKnockingPurpose] ??
  FALLBACK_NAME

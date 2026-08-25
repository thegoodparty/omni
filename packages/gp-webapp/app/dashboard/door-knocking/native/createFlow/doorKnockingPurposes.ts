// Door knocking's own goal cards, from its own canvas list (the prototype's
// DOOR_PURPOSES). Deliberately NOT social's copy, and not phone banking's
// either: this channel's goals are about a conversation on a doorstep, so
// "Discover local issues" and "Turn out my supporters" have no equivalent on a
// channel that sends a message. Robocall and phone banking both shipped with
// social's labels copy-pasted and had to be corrected (#1379) — the correction
// is cheaper than the copy-paste.
//
// The slugs are local rather than a contracts enum, unlike PhoneBankingPurpose:
// nothing persists a door-knocking purpose. It shapes the flow and seeds a name
// suggestion, and never crosses the wire, so there is no payload to agree with.
export const DOOR_KNOCKING_PURPOSE_VALUES = [
  'issue',
  'introduce',
  'persuade',
  'turnout',
  'event',
  'custom',
] as const

export type DoorKnockingPurpose = (typeof DOOR_KNOCKING_PURPOSE_VALUES)[number]

export const DOOR_KNOCKING_PURPOSE_LABELS: Record<DoorKnockingPurpose, string> =
  {
    issue: 'Discover local issues',
    introduce: 'Introduce myself',
    persuade: 'Persuade undecided voters',
    turnout: 'Turn out my supporters',
    event: 'Invite people to an event',
    custom: 'Something else',
  }

// A second line on the card, which phone banking has no equivalent of: a
// door-knocking goal decides how a candidate spends an evening on foot, and
// the one-liner is what separates "persuade" from "turn out" before the
// filters step asks them to express the difference in pills.
export const DOOR_KNOCKING_PURPOSE_DESCRIPTIONS: Record<
  DoorKnockingPurpose,
  string
> = {
  issue: 'Hear what neighbors care about most.',
  introduce: 'Meet voters who do not know you yet.',
  persuade: 'Talk with voters who could still swing your way.',
  turnout: 'Remind likely supporters to vote.',
  event: 'Promote a town hall or meet and greet.',
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
  issue: 'Listening walk',
  introduce: 'Introduction walk',
  persuade: 'Persuasion walk',
  turnout: 'Turnout walk',
  event: 'Event invite walk',
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

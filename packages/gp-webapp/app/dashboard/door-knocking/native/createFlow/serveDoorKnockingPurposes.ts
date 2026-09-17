import {
  SERVE_OUTREACH_PURPOSE_VALUES,
  type ServeOutreachPurpose,
} from '@goodparty_org/contracts'

export type ServeDoorKnockingPurpose = ServeOutreachPurpose

export const SERVE_DOOR_KNOCKING_PURPOSE_VALUES = SERVE_OUTREACH_PURPOSE_VALUES

// Door knocking's own wording for the shared Serve slugs — deliberately NOT
// phone banking's copy, the same rule the Win labels follow in
// doorKnockingPurposes.ts: this channel's goals are about a conversation on a
// doorstep, so the phrasing stays door-knocking's own. The three slugs Serve
// shares with Win keep Win's door-knocking wording, because a doorstep
// conversation about an event reads the same on either rail.
export const SERVE_DOOR_KNOCKING_PURPOSE_LABELS: Record<
  ServeDoorKnockingPurpose,
  string
> = {
  introduce_myself: 'Introduce myself',
  explain_decision: 'Explain a recent decision',
  event_invite: 'Invite people to an event',
  community_input: 'Ask for community input',
  share_resource: 'Share a resource or service',
  custom: 'Something else',
}

const FALLBACK_NAME = 'Door knocking list'

// Deliberately a second record rather than a derivation of the labels above —
// the #1385 lesson, arrived at by renaming live campaigns. A label is copy on
// a card, phrased as a goal ("Explain a recent decision"); a name suggestion
// is a default title for a saved list in the rail ("Decision update walk").
// Collapsing them means the next copy correction to a card silently renames
// lists.
export const SERVE_DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS: Record<
  ServeDoorKnockingPurpose,
  string
> = {
  introduce_myself: 'Introduction walk',
  explain_decision: 'Decision update walk',
  event_invite: 'Event invite walk',
  community_input: 'Community input walk',
  share_resource: 'Resource walk',
  // The flow suggests nothing for custom; the entry keeps the record total so
  // a new purpose is a compile error here.
  custom: FALLBACK_NAME,
}

export const SERVE_DOOR_KNOCKING_PURPOSES: {
  id: ServeDoorKnockingPurpose
  label: string
}[] = SERVE_DOOR_KNOCKING_PURPOSE_VALUES.map((id) => ({
  id,
  label: SERVE_DOOR_KNOCKING_PURPOSE_LABELS[id],
}))

export const serveDoorKnockingPurposeLabel = (purpose: string): string =>
  SERVE_DOOR_KNOCKING_PURPOSE_LABELS[purpose as ServeDoorKnockingPurpose] ??
  FALLBACK_NAME

export const serveDoorKnockingPurposeNameSuggestion = (
  purpose: string,
): string =>
  SERVE_DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS[
    purpose as ServeDoorKnockingPurpose
  ] ?? FALLBACK_NAME

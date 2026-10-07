import {
  SERVE_PHONE_BANKING_PURPOSE_VALUES,
  type ServePhoneBankingPurpose,
} from '@goodparty_org/contracts'

// Contract slugs → the design canvas's card copy. Serve's own vocabulary
// (constituent framing, no election mechanics) — see phoneBankingPurposes.ts
// for the Win equivalent.
export const SERVE_PHONE_BANKING_PURPOSE_LABELS: Record<
  ServePhoneBankingPurpose,
  string
> = {
  introduce_myself: 'Introduce myself to constituents',
  explain_decision: 'Explain a recent decision',
  event_invite: 'Invite constituents to a local event',
  community_input: 'Ask for community input',
  share_resource: 'Share a resource or service',
  custom: 'Write my own script',
}

const FALLBACK_NAME = 'Phone banking calls'

// Deliberately a second record rather than a derivation of the labels above,
// mirroring phoneBankingPurposes.ts: a label is copy on a card, phrased as an
// instruction to the caller ("Explain a recent decision"), while a name
// suggestion is a default title for a campaign in the outreach history list
// ("Decision update calls"). Collapsing them means the next copy correction
// to a card silently renames campaigns (#1385).
export const SERVE_PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS: Record<
  ServePhoneBankingPurpose,
  string
> = {
  introduce_myself: 'Introduction calls',
  explain_decision: 'Decision update calls',
  event_invite: 'Event invite calls',
  community_input: 'Community input calls',
  share_resource: 'Resource calls',
  // The flow suggests nothing for custom; the entry keeps the record total so
  // a new purpose is a compile error here.
  custom: FALLBACK_NAME,
}

export const SERVE_PHONE_BANKING_PURPOSES: {
  id: ServePhoneBankingPurpose
  label: string
}[] = SERVE_PHONE_BANKING_PURPOSE_VALUES.map((id) => ({
  id,
  label: SERVE_PHONE_BANKING_PURPOSE_LABELS[id],
}))

export const servePhoneBankingPurposeLabel = (purpose: string): string =>
  SERVE_PHONE_BANKING_PURPOSE_LABELS[purpose as ServePhoneBankingPurpose] ??
  FALLBACK_NAME

export const servePhoneBankingPurposeNameSuggestion = (
  purpose: string,
): string =>
  SERVE_PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS[
    purpose as ServePhoneBankingPurpose
  ] ?? FALLBACK_NAME

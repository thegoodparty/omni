import {
  SERVE_SMS_PURPOSE_VALUES,
  type ServeSmsPurpose,
} from '@goodparty_org/contracts'

// Contract slugs → the card copy on the SMS flow's first step. Serve's own
// vocabulary (constituent framing, no election mechanics) — the Win
// equivalent is SMS_PURPOSES in sms/smsCompose.util.ts, which borrows the
// social labels.
//
// The slugs are SERVE_SMS_PURPOSE_VALUES: the shared list serve phone
// banking and serve door knocking draw from, so a Serve row is readable
// across channels without a per-channel translation table, plus the
// SMS-only build_citizens_panel, which SmsFlow offers only behind
// serve-citizen-panels, and report_back, which only a chat card opens.
export const SERVE_SMS_PURPOSE_LABELS: Record<ServeSmsPurpose, string> = {
  build_citizens_panel: 'Build your civic panel',
  report_back: 'Report back to the people you asked',
  introduce_myself: 'Introduce myself to constituents',
  explain_decision: 'Explain a recent decision',
  event_invite: 'Invite constituents to a local event',
  community_input: 'Ask for community input',
  share_resource: 'Share a resource or service',
  custom: 'Write my own message',
}

// Also the Win flow's auto-name fallback, so a Serve send with no purpose
// yet reads the same as a Win one.
const FALLBACK_NAME = 'Text campaign'

// Deliberately a second record rather than a derivation of the labels above,
// mirroring serveSocialPurposes.ts and servePhoneBankingPurposes.ts: a label
// is copy on a card, phrased as the thing the official wants to do ("Explain
// a recent decision"), while a name suggestion is a default title for an
// outreach campaign in the history list ("Decision update texts"). Collapsing
// them means the next copy correction to a card silently renames campaigns
// (#1385).
export const SERVE_SMS_PURPOSE_NAME_SUGGESTIONS: Record<
  ServeSmsPurpose,
  string
> = {
  build_citizens_panel: 'Civic panel invite texts',
  report_back: 'Report back texts',
  introduce_myself: 'Introduction texts',
  explain_decision: 'Decision update texts',
  event_invite: 'Event invite texts',
  community_input: 'Community input texts',
  share_resource: 'Resource texts',
  // The flow suggests nothing for custom; the entry keeps the record total so
  // a new purpose is a compile error here.
  custom: FALLBACK_NAME,
}

export const SERVE_SMS_PURPOSES: {
  id: ServeSmsPurpose
  label: string
}[] = SERVE_SMS_PURPOSE_VALUES.map((id) => ({
  id,
  label: SERVE_SMS_PURPOSE_LABELS[id],
}))

export const serveSmsPurposeLabel = (purpose: string): string =>
  SERVE_SMS_PURPOSE_LABELS[purpose as ServeSmsPurpose] ?? FALLBACK_NAME

export const serveSmsPurposeNameSuggestion = (purpose: string): string =>
  SERVE_SMS_PURPOSE_NAME_SUGGESTIONS[purpose as ServeSmsPurpose] ??
  FALLBACK_NAME

import type {
  ServeOutreachPurpose,
  SmsPurpose,
  SocialTone,
} from '@goodparty_org/contracts'
import { SMS_PURPOSE_VALUES } from '@goodparty_org/contracts'
import { SOCIAL_PURPOSE_LABELS } from '../socialPurposes'

// SMS purposes are the social slugs minus issue_update; labels shared.
export const SMS_PURPOSES: { id: SmsPurpose; label: string }[] =
  SMS_PURPOSE_VALUES.map((id) => ({ id, label: SOCIAL_PURPOSE_LABELS[id] }))

// Every purpose slug the SMS flow can carry, across both surfaces — same
// convention as SocialFlowPurpose and PhoneBankingFlowPurpose. Lives here
// rather than in SmsFlow so the step components can name it without
// importing the flow back.
export type SmsFlowPurpose = SmsPurpose | ServeOutreachPurpose

export const smsPurposeLabel = (purpose: string): string =>
  SOCIAL_PURPOSE_LABELS[purpose as SmsPurpose] ?? 'Text message'

export const OPT_OUT_FOOTER = 'Reply STOP to opt out.'

// Compliance: the "Paid for by <committee>" disclaimer is system-owned, like
// the opt-out line — appended deterministically to every message (product
// decision 2026-09-02), never left to the candidate or the LLM.
export const paidForByLine = (committeeName: string): string =>
  `Paid for by ${committeeName}.`

export const composeFooter = (committeeName?: string | null): string =>
  committeeName
    ? `${paidForByLine(committeeName)}\n${OPT_OUT_FOOTER}`
    : OPT_OUT_FOOTER

// Peerly merges {first_name} from the uploaded list CSV — the same token our
// own 10DLC identity registration samples use ("Hello {first_name}, this is
// Jack…"), so the vendor contract already depends on it. Verify the merge on
// the dev end-to-end pass before GA.
export const SMS_GREETING = 'Hello {first_name},'

// Serve's greeting differs by exactly one pair of braces, and the braces are
// the whole point: Peerly merges the single-brace form, while Serve is
// fulfilled by a human through the sending tool polls already uses, which
// merges the DOUBLE-brace form. `polls/create/CreatePoll.tsx` converts its
// authored `[Name]` to `{{first_name}}` on submit for the same reason. Get
// this wrong and the constituent is texted the token verbatim.
//
// Nothing authors this token on either surface — the greeting is a system
// region and the compose step shows it as a "Greeting First Name" chip — so
// there is no `[Name]` affordance to convert here, only an emitted token.
export const SERVE_SMS_GREETING = 'Hello {{first_name}},'

// Compliance: every SMS opens with a candidate identification. Per the
// design, it is the first sentence of the EDITABLE message: fresh AI drafts
// are prepended with it, and checkSmsStandards blocks the CTA when an edit
// removes it. Tone-flavored per the design prototype's
// introFor; reads as the continuation of SMS_GREETING, so no variant
// carries its own greeting word. The CS compose-rules pass may replace
// this wording.
export const identificationIntro = (
  tone: SocialTone,
  firstName: string,
  office: string,
): string => {
  const name = firstName || 'your candidate'
  const role = office || 'local office'
  if (tone === 'direct') return `${name} here, candidate for ${role}.`
  if (tone === 'urgent') return `${name} here, running for ${role}.`
  if (tone === 'friendly') return `it's ${name}, running for ${role}.`
  return `this is ${name}, candidate for ${role}.`
}

// Serve's identification sentence. Win's four variants all say the person is
// running for something ("candidate for {office}", "running for {office}"),
// which an elected official is not: they already hold the office. So this is
// not a reworded Win line, it is the other half of the same compliance
// requirement — say who is texting.
//
// The wording is polls' own shipped copy, not new phrasing: `introOptions` in
// `app/dashboard/polls/create/CreatePoll.tsx` already introduces an official
// as "I'm {name}, your {office}.", so the two Serve products introduce the
// same person the same way. Urgent and direct converge on one line on
// purpose — "running for" is what separated them on Win and it has no
// elected-official equivalent.
//
// A SERVE_* record rather than a ternary so the Serve vocabulary gate can see
// every string (docs/product-vocabulary.md).
export const SERVE_SMS_IDENTIFICATION_INTRO: Record<
  SocialTone,
  (name: string, office: string) => string
> = {
  warm: (name, office) => `this is ${name}, your ${office}.`,
  direct: (name, office) => `${name} here, your ${office}.`,
  friendly: (name, office) => `it's ${name}, your ${office}.`,
  urgent: (name, office) => `${name} here, your ${office}.`,
}

// Last resort only. The name comes from the signed-in user and the office
// from the organization's position name, so in practice both are present;
// these exist so a missing one degrades to a sentence rather than to
// "this is , your ." the way an empty interpolation would.
export const SERVE_SMS_IDENTIFICATION_FALLBACK = {
  name: 'your elected official',
  office: 'local elected official',
}

// Serve twin of `identificationIntro` above. The office argument is expected
// to have been through `grammarizeOfficeName` already ("City Council" ->
// "City Council Member", " - District 3" stripped); this function does not
// re-derive that grammar.
export const serveIdentificationIntro = (
  tone: SocialTone,
  firstName: string,
  office: string,
): string =>
  SERVE_SMS_IDENTIFICATION_INTRO[tone](
    firstName || SERVE_SMS_IDENTIFICATION_FALLBACK.name,
    office || SERVE_SMS_IDENTIFICATION_FALLBACK.office,
  )

// The submitted script is the concatenation of the system regions around
// the user's message (which opens with the identification) — the backend
// has no region concept and sends the script to the vendor verbatim
// (merge token included).
// The footer (paid-for-by + opt-out) sits after a blank line (design parity
// in the preview bubble; SMS newlines are legal and Peerly gets the script
// verbatim).
const composeWithGreeting = (
  greeting: string,
  body: string,
  committeeName?: string | null,
): string =>
  [
    [greeting, body.trim()].filter(Boolean).join(' '),
    composeFooter(committeeName),
  ]
    .filter(Boolean)
    .join('\n\n')

export const composeScript = (
  body: string,
  committeeName?: string | null,
): string => composeWithGreeting(SMS_GREETING, body, committeeName)

// Serve's composed message. The opt-out footer stays: honoring STOP follows
// the message, not the sender, and a Serve send is squarely a repeat-send
// product. Paid-for-by does not: it is a campaign-finance disclaimer naming
// a candidate committee, and an elected official texting constituents has no
// committee to name. So this is not a copy choice with a Serve wording —
// there is simply nothing to disclose (docs/features/serve-sms.md,
// "Opt-out").
export const composeServeScript = (body: string): string =>
  composeWithGreeting(SERVE_SMS_GREETING, body, null)

export const IMAGE_MAX_BYTES = 500000
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif'

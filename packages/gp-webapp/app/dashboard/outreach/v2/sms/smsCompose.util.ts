import type { SmsPurpose, SocialTone } from '@goodparty_org/contracts'
import { SMS_PURPOSE_VALUES } from '@goodparty_org/contracts'
import { SOCIAL_PURPOSE_LABELS } from '../socialPurposes'

// SMS purposes are the social slugs minus issue_update; labels shared.
export const SMS_PURPOSES: { id: SmsPurpose; label: string }[] =
  SMS_PURPOSE_VALUES.map((id) => ({ id, label: SOCIAL_PURPOSE_LABELS[id] }))

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

// Compliance: every SMS opens with a candidate identification. Per the
// design, it is the first sentence of the EDITABLE message: fresh AI drafts
// are prepended with it, and hasIdentification warns (and the CTA blocks)
// when an edit removes it. Tone-flavored per the design prototype's
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

// The submitted script is the concatenation of the system regions around
// the user's message (which opens with the identification) — the backend
// has no region concept and sends the script to the vendor verbatim
// (merge token included).
// The footer (paid-for-by + opt-out) sits after a blank line (design parity
// in the preview bubble; SMS newlines are legal and Peerly gets the script
// verbatim).
export const composeScript = (
  body: string,
  committeeName?: string | null,
): string =>
  [
    [SMS_GREETING, body.trim()].filter(Boolean).join(' '),
    composeFooter(committeeName),
  ]
    .filter(Boolean)
    .join('\n\n')

export const IMAGE_MAX_BYTES = 500000
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif'

// Pre-compliance-launch identification check (prototype's hasIntro), used
// while the voter-outreach-sms-compliance flag is off: the message head
// must read as an identification. With no first name on file the name
// check is vacuous, so only the candidacy phrasing is required.
export const hasIdentification = (body: string, firstName: string): boolean => {
  const head = body.slice(0, 140).toLowerCase()
  const nameOk =
    firstName.trim().length === 0 ||
    head.includes(firstName.trim().toLowerCase())
  return nameOk && (head.includes('candidate') || head.includes('running for'))
}

// Inverse of composeScript, for edit-before-send (pre-launch only):
// recover the editable body from a stored script by peeling the known
// system regions. Tolerant of legacy rows that predate the region model —
// whatever doesn't match is simply kept as body text.
export const stripComposedScript = (script: string): string => {
  let body = script
  if (body.endsWith(`\n\n${OPT_OUT_FOOTER}`)) {
    body = body.slice(0, -`\n\n${OPT_OUT_FOOTER}`.length)
  }
  if (body.startsWith(`${SMS_GREETING} `)) {
    body = body.slice(SMS_GREETING.length + 1)
  }
  return body.trim()
}

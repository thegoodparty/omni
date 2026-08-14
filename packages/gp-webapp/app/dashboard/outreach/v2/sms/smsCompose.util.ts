import type { SmsPurpose, SocialTone } from '@goodparty_org/contracts'
import { SMS_PURPOSE_VALUES } from '@goodparty_org/contracts'
import { SOCIAL_PURPOSE_LABELS } from '../socialPurposes'

// SMS purposes are the social slugs minus issue_update; labels shared.
export const SMS_PURPOSES: { id: SmsPurpose; label: string }[] =
  SMS_PURPOSE_VALUES.map((id) => ({ id, label: SOCIAL_PURPOSE_LABELS[id] }))

export const smsPurposeLabel = (purpose: string): string =>
  SOCIAL_PURPOSE_LABELS[purpose as SmsPurpose] ?? 'Text message'

export const OPT_OUT_FOOTER = 'Reply STOP to opt out.'

// Compliance: every SMS opens with a candidate identification. System-owned
// region (not editable in the compose step), tone-flavored per the design
// prototype's introFor. The CS compose-rules pass may replace this wording.
export const identificationIntro = (
  tone: SocialTone,
  firstName: string,
  office: string,
): string => {
  const name = firstName || 'your candidate'
  const role = office || 'local office'
  if (tone === 'direct') return `${name} here, candidate for ${role}.`
  if (tone === 'urgent') return `${name} here, running for ${role}.`
  if (tone === 'friendly') return `Hey! It's ${name}, running for ${role}.`
  return `Hi, this is ${name}, candidate for ${role}.`
}

// The submitted script is the concatenation of the system regions around
// the user's body — the backend has no region concept and sends the script
// to the vendor verbatim.
export const composeScript = (
  intro: string,
  body: string,
  footer: string = OPT_OUT_FOOTER,
): string => [intro, body.trim(), footer].filter(Boolean).join(' ')

export const IMAGE_MAX_BYTES = 500000
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif'

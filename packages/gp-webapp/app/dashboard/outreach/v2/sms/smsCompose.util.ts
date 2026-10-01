import type {
  ServeOutreachPurpose,
  SmsPurpose,
  SocialTone,
} from '@goodparty_org/contracts'
import { checkSmsStandards, SMS_PURPOSE_VALUES } from '@goodparty_org/contracts'
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

// A draft saved before verification was composed with no committee, so its
// system footer is the opt-out line alone. Resume carries the saved script
// verbatim (re-composing would double the footer), so only the footer is
// upgraded once the committee name exists -- the same line scheduling's
// server-side compliance check demands.
// Structural, not a phrase search: matching "paid for by" anywhere would
// also fire on body text and skip the injection, and a trailing footer that
// names some OTHER committee is left alone so the standards check fails
// closed instead of a second line being stacked under the first.
export const upgradeScriptFooter = (
  script: string,
  committeeName: string | null,
): string => {
  if (!committeeName) return script
  const upgraded = `\n\n${composeFooter(committeeName)}`
  if (script.endsWith(upgraded)) return script
  const bare = `\n\n${OPT_OUT_FOOTER}`
  if (!script.endsWith(bare)) return script
  return script.slice(0, script.length - bare.length) + upgraded
}

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
// region shown above the message box — so there is no `[Name]` affordance to
// convert here, only an emitted token.
export const SERVE_SMS_GREETING = 'Hello {{first_name}},'

// One stand-in first name, shared by the compose step's greeting chip (both
// surfaces) and Serve's review preview bubble, so they read as the message
// a recipient receives rather than as a merge token. Display only: the
// script that goes to fulfilment always carries the literal token.
export const SERVE_SMS_SAMPLE_FIRST_NAME = 'Sam'

export const withSampleFirstName = (text: string): string =>
  text.replace(/\{\{first_name\}\}/g, SERVE_SMS_SAMPLE_FIRST_NAME)

// The chip above the body shows the greeting as the words that open the
// text, not as a variable name: a candidate who reads "Greeting First
// Name" writes their own "Hello!" under it, and the script goes to Peerly
// as "Hello {first_name}, Hello! …" (CAS, 2026-09-29). Both surfaces greet
// with the same words and differ only in the merge token, so one preview
// serves both.
export const SMS_GREETING_PREVIEW = {
  greeting: withSampleFirstName(SERVE_SMS_GREETING),
  caption: 'Each person sees their own first name.',
}

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

// --- Identification guard -------------------------------------------------
//
// Every body the product writes or carries in for someone (a deep-link
// preset, an agent's proposal, an AI draft, an Improve result, a remembered
// tone draft) must already pass the candidate_name standard when it lands in
// the composer, or the first thing the official sees is a compliance error
// on words they did not write. Hand-typed text never goes through this.
// Shared with the agent cards that hand a text off to the composer, so the
// two cannot disagree about what "identified" means.

// Placeholders that can only mean the sender's own name. A bare "[Name]" is
// NOT one of them on its own: polls author "[Name]" for the RECIPIENT, so it
// is only read as the sender when a self-introduction sits right before it
// ("this is [Name]") or "here" right after it ("[Name] here").
const SENDER_NAME_PLACEHOLDER =
  /\[\s*(?:your|my|candidate(?:['’]s)?|official(?:['’]s)?|sender(?:['’]s)?)\s+(?:first\s+|full\s+)?name\s*\]/gi
const SELF_INTRO_NAME_PLACEHOLDER =
  /\b(this\s+is|it['’]s|it\s+is|i['’]m|i\s+am|my\s+name\s+is)\s+\[\s*(?:first\s+|full\s+)?name\s*\]/gi
const NAME_HERE_PLACEHOLDER =
  /\[\s*(?:first\s+|full\s+)?name\s*\](?=\s+here\b)/gi

const hasSenderPlaceholder = (text: string): boolean =>
  [
    SENDER_NAME_PLACEHOLDER,
    SELF_INTRO_NAME_PLACEHOLDER,
    NAME_HERE_PLACEHOLDER,
  ].some((pattern) => text.search(pattern) !== -1)

const fillSenderPlaceholders = (text: string, firstName: string): string =>
  firstName
    ? text
        .replace(SENDER_NAME_PLACEHOLDER, firstName)
        .replace(SELF_INTRO_NAME_PLACEHOLDER, `$1 ${firstName}`)
        .replace(NAME_HERE_PLACEHOLDER, firstName)
    : text

// The composed message already opens "Hello {first_name},", so a body's own
// greeting would be a second one. Punctuation is required for a greeting
// standing alone ("Hey there neighbors" may be the start of a sentence);
// before a self-introduction it is optional ("Hi this is ...").
const GREETING_WORDS =
  '(?:hi|hello|hey|greetings|good\\s+(?:morning|afternoon|evening))\\b(?:\\s+(?:there|neighbou?rs?|friends?|all|everyone|\\{{1,2}first_name\\}{1,2}))?'
const LONE_GREETING = new RegExp(`^${GREETING_WORDS}\\s*[,!.:—–-]+\\s*`, 'i')
const GREETING_BEFORE_INTRO = new RegExp(
  `^${GREETING_WORDS}\\s*[,!.:—–-]*\\s*`,
  'i',
)

const SELF_INTRO =
  /^(?:this\s+is|it['’]s|it\s+is|i['’]m|i\s+am|my\s+name\s+is)\s/i
const NAME_HERE = /^\S+(?:\s+\S+)?\s+here\b/i
// An opener that names an institution instead of a person ("this is the
// Asheville City Council", "this is your city council candidate"). Only the
// words between the article and the office noun may be capitalized names, so
// "This is the last day to vote in our city" is not mistaken for one.
const INSTITUTION_INTRO =
  /^(?:[Tt]his\s+is|[Mm]y\s+name\s+is)\s+(?:the|your)\s+(?:[A-Z][\w'’.-]*\s+){0,4}(?:[Cc]ity|[Tt]own|[Cc]ounty|[Vv]illage|[Cc]ouncil|[Oo]ffice|[Bb]oard|[Cc]ommission(?:er)?|[Mm]ayor|[Dd]istrict|[Dd]epartment|[Cc]ampaign|[Cc]andidate|[Oo]fficial|[Rr]epresentative|[Tt]rustee|[Ss]upervisor)(?![\w'’])/

const firstSentence = (text: string): string =>
  text.match(/^[^\n]*?[.!?](?=\s|$)/)?.[0] ?? text.match(/^[^\n]*/)?.[0] ?? ''

const capitalizeFirst = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1)

export interface SmsIdentificationContext {
  // The surface's own identification sentence for the current tone: Win's
  // identificationIntro or Serve's useServeSmsIdentification.
  intro: string
  firstName: string
  // The same names the compose step's candidate_name check matches against.
  candidateNames: string[]
}

export const ensureSmsIdentification = (
  body: string,
  { intro, firstName, candidateNames }: SmsIdentificationContext,
): string => {
  const names = candidateNames.map((name) => name.trim()).filter(Boolean)
  if (body.trim().length === 0 || names.length === 0) return body
  const namesSender = (text: string): boolean =>
    !checkSmsStandards(text, { candidateNames: names }).failures.includes(
      'candidate_name',
    )
  if (namesSender(body) && !hasSenderPlaceholder(body)) return body

  const isOpener = (sentence: string): boolean =>
    sentence.length <= 160 &&
    (SELF_INTRO.test(sentence) || NAME_HERE.test(sentence)) &&
    (hasSenderPlaceholder(sentence) ||
      namesSender(sentence) ||
      INSTITUTION_INTRO.test(sentence))

  // Drop every self-introduction the body opens with, including one sitting
  // under an intro an earlier pass already prepended, so the result carries
  // exactly one.
  let rest = body.trim()
  let replacedOpener = false
  for (;;) {
    const greeting = rest.match(GREETING_BEFORE_INTRO)?.[0] ?? ''
    const afterGreeting = rest.slice(greeting.length)
    const sentence = firstSentence(afterGreeting)
    if (!sentence || !isOpener(sentence)) break
    rest = afterGreeting.slice(sentence.length).trimStart()
    replacedOpener = true
  }
  const ungreeted = rest.replace(LONE_GREETING, '')
  const trimmedStart = replacedOpener || ungreeted !== rest
  rest = fillSenderPlaceholders(ungreeted, firstName).trim()

  if (!replacedOpener && namesSender(rest)) return rest
  if (!rest) return intro
  return `${intro} ${trimmedStart ? capitalizeFirst(rest) : rest}`
}

// Square brackets a draft left for the sender to fill in ("[Date]",
// "[time]"). Shown on the compose step so nothing goes out with one.
export const unfilledBrackets = (body: string): string[] => [
  ...new Set(body.match(/\[[^\]\n]+\]/g) ?? []),
]

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

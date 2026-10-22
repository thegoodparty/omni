import type {
  ServeSmsPurpose,
  SmsPurpose,
  SocialTone,
} from '@goodparty_org/contracts'
import {
  checkSmsStandards,
  CIVIC_PANEL_JOIN_LINE,
  CIVIC_PANEL_LEAVE_LINE,
  findCivicPanelJoinLine,
  findCivicPanelLeaveLine,
  SMS_PURPOSE_VALUES,
} from '@goodparty_org/contracts'
import { SOCIAL_PURPOSE_LABELS } from '../socialPurposes'

// SMS purposes are the social slugs minus issue_update; labels shared.
export const SMS_PURPOSES: { id: SmsPurpose; label: string }[] =
  SMS_PURPOSE_VALUES.map((id) => ({ id, label: SOCIAL_PURPOSE_LABELS[id] }))

// Every purpose slug the SMS flow can carry, across both surfaces — same
// convention as SocialFlowPurpose and PhoneBankingFlowPurpose. Lives here
// rather than in SmsFlow so the step components can name it without
// importing the flow back.
export type SmsFlowPurpose = SmsPurpose | ServeSmsPurpose

export const smsPurposeLabel = (purpose: string): string =>
  SOCIAL_PURPOSE_LABELS[purpose as SmsPurpose] ?? 'Text message'

export const OPT_OUT_FOOTER = 'Reply STOP to opt out.'

// The opt-out sentence however a person retyped it: the standards check
// accepts STOP in quotes, so every rewrite must read that line as the
// opt-out too, or it would add a second one below it.
const OPT_OUT_SENTENCE =
  /Reply\s+["'“”‘’]?STOP["'“”‘’]?\s+to\s+opt[\s-]?out\.?/i

// Compliance: the "Paid for by <committee>" disclaimer, like the opt-out
// line, is composed into every fresh message and then locked inside it: the
// candidate writes around it, and Improve sends it masked so the model never
// sees it (docs/features/message-composer.md).
export const paidForByLine = (committeeName: string): string =>
  `Paid for by ${committeeName}.`

export const composeFooter = (committeeName?: string | null): string =>
  committeeName
    ? // One line: an SMS footer reads as a sign-off, not a block of lines.
      `${paidForByLine(committeeName)} ${OPT_OUT_FOOTER}`
    : OPT_OUT_FOOTER

// Brings a message's footer up to the committee it should name now. The
// footer is system-written and locked in the field, so any trailing footer
// of that shape is the system's own: the bare opt-out line of a draft saved
// before the disclaimer was always shown, or a "Paid for by" line naming a
// provisional or earlier committee. It is rewritten to the current one,
// which is the line scheduling's server-side compliance check demands.
// Structural, not a phrase search: matching "paid for by" anywhere would
// also fire on body text, and the blank line before the footer is what the
// composer always writes. A message whose footer is not the last thing in
// it is left alone, so the standards check fails closed.
const SYSTEM_FOOTER = new RegExp(
  // A space or a line break before the opt-out: drafts saved before the
  // footer was one line put them on two.
  `\\n\\n(?:Paid for by [^\\n]*?\\.[ \\n])?${OPT_OUT_FOOTER.replace(/[.]/g, '\\.')}$`,
)

export const upgradeScriptFooter = (
  script: string,
  committeeName: string | null,
): string => {
  if (!committeeName) return script
  const upgraded = `\n\n${composeFooter(committeeName)}`
  if (script.endsWith(upgraded)) return script
  const stale = SYSTEM_FOOTER.exec(script)
  if (!stale) return script
  return script.slice(0, stale.index) + upgraded
}

// Removes one span of text, mending the gap it leaves: a line of its own
// takes its paragraph break with it, words inside a sentence keep one space.
const cutSpan = (text: string, start: number, end: number): string => {
  const before = text.slice(0, start).replace(/[ \t]+$/, '')
  const after = text.slice(end).replace(/^[ \t]+/, '')
  if (after === '') return before.trimEnd()
  if (before === '') return after.trimStart()
  if (before.endsWith('\n') || after.startsWith('\n')) {
    return `${before}${after}`.replace(/\n{3,}/g, '\n\n')
  }
  return `${before} ${after}`
}

const removeEvery = (text: string, patterns: RegExp[]): string => {
  let result = text
  for (const pattern of patterns) {
    for (;;) {
      const match = pattern.exec(result)
      if (!match) break
      result = cutSpan(result, match.index, match.index + match[0].length)
    }
  }
  return result
}

// Every wording of a civic panel line, the stored ones and a model's echo of
// one: the whole JOIN line through its sign-off, or the ask sentence alone.
// The flow writes the one line a message should carry, so any other copy is
// a duplicate.
const JOIN_LINE_PATTERNS = [
  /Reply JOIN to join my (?:civic|citizens['’]) panel[^\n]*?(?:Sent with|Empowered by) GoodParty\.org\./i,
  /Reply JOIN to join my (?:civic|citizens['’]) panel[^\n]*?(?:[.!](?=\s|$)|(?=\n)|$)/i,
]
const LEAVE_LINE_PATTERNS = [
  /Reply LEAVE to leave my (?:civic|citizens['’]) panel[^\n]*?(?:[.!](?=\s|$)|(?=\n)|$)/i,
]

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// What a body must never carry, because the flow writes it around the body:
// the civic panel lines, the opt-out line and the "Paid for by" disclaimer.
// A model that echoes one would otherwise send it twice.
const withoutLockedLines = (
  body: string,
  committeeName?: string | null,
): string =>
  removeEvery(body, [
    ...JOIN_LINE_PATTERNS,
    ...LEAVE_LINE_PATTERNS,
    ...(committeeName
      ? [new RegExp(escapeRegExp(paidForByLine(committeeName)))]
      : []),
    OPT_OUT_SENTENCE,
  ])

// Puts back what an Improve reply dropped of the parts the system writes:
// the footer as the message's closing paragraph, and the greeting when the
// merge token is gone. gp-api masks both, so a reply normally keeps them and
// comes back unchanged; one that does not is from a gp-api that predates
// masking (a deploy where the webapp lands first), and must never reach a
// send without them. Judged by structure, not phrases: only a separate
// closing paragraph that opens like a footer is replaced, so a body sentence
// or paragraph that says "reply STOP" stays, and a reworded greeting that
// kept the token is the candidate's to keep.
export const restoreSmsSystemRegions = (
  reply: string,
  regions: { greeting: string; footer: string; token: string },
): string => {
  let text = reply.trim()
  if (regions.footer) {
    // A reply that closes on the exact footer kept it, whatever gap the
    // model left before it; the gap goes back to the blank line it had.
    const closes = text.endsWith(regions.footer)
    const body = closes
      ? text.slice(0, text.length - regions.footer.length)
      : // Only a closing paragraph that opens the way a footer does: one that
        // merely mentions "paid for by" or "reply STOP" is the candidate's.
        text.replace(/\n\n(?:Paid for by |Reply\s+["'“”‘’]?STOP\b)[^\n]*$/i, '')
    // The civic panel line is not part of the body either: the caller puts
    // back the one the message should carry, so a copy the model kept or
    // wrote would otherwise be a second one, and an exact copy of the footer
    // inside the body would be a second opt-out.
    const cleanBody = removeEvery(body, [
      ...JOIN_LINE_PATTERNS,
      ...LEAVE_LINE_PATTERNS,
      new RegExp(escapeRegExp(regions.footer)),
      OPT_OUT_SENTENCE,
    ])
    text = `${cleanBody.trimEnd()}\n\n${regions.footer}`
  }
  if (!text.includes(regions.token)) text = `${regions.greeting} ${text}`
  return text
}

// The committee a campaign names before verification has recorded the real
// one, so the message always shows its "Paid for by" line. Never sent: a
// campaign cannot schedule a text until it is verified, and verification
// records the committee, which upgradeScriptFooter then swaps in. The name
// alone, with no office: an office reads badly in a disclaimer ("Palm Bay
// City Council - Seat 5"). The same fallback the robocall disclosure uses.
export const provisionalCommitteeName = (
  candidateName: string,
): string | null => candidateName.trim() || null

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
// this wording. The full name, not the first name alone: a voter texted
// "this is Jane" from a number they do not know cannot tell which Jane is
// asking for their vote (CAS, 2026-10-14).
export const identificationIntro = (
  tone: SocialTone,
  fullName: string,
  office: string,
): string => {
  const name = fullName || 'your candidate'
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
// elected-official equivalent. The name is the official's full name, as
// polls use it: an official asked to be named in full every time
// (2026-10-14).
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
  fullName: string,
  office: string,
): string =>
  SERVE_SMS_IDENTIFICATION_INTRO[tone](
    fullName || SERVE_SMS_IDENTIFICATION_FALLBACK.name,
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

const fillSenderPlaceholders = (text: string, name: string): string =>
  name
    ? text
        .replace(SENDER_NAME_PLACEHOLDER, name)
        .replace(SELF_INTRO_NAME_PLACEHOLDER, `$1 ${name}`)
        .replace(NAME_HERE_PLACEHOLDER, name)
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
  // What a sender-name placeholder is filled with: the name the intro uses,
  // so a filled body names the sender the way the intro does (the full name
  // on both surfaces).
  senderName: string
  // The same names the compose step's candidate_name check matches against.
  candidateNames: string[]
}

const identify = (
  body: string,
  { intro, senderName, candidateNames }: SmsIdentificationContext,
  mode: 'ensure' | 'open',
): string => {
  const names = candidateNames.map((name) => name.trim()).filter(Boolean)
  if (body.trim().length === 0) return mode === 'open' ? intro : body
  if (names.length === 0) {
    return mode === 'open' ? `${intro} ${body}` : body
  }
  const namesSender = (text: string): boolean =>
    !checkSmsStandards(text, { candidateNames: names }).failures.includes(
      'candidate_name',
    )
  if (mode === 'ensure' && namesSender(body) && !hasSenderPlaceholder(body)) {
    return body
  }

  // NAME_HERE stops at two words before "here", which a longer full name
  // overruns ("Mary Ann Smith here, ...", Win's direct and urgent intros), so
  // a sentence that opens on one of the sender's own names counts too.
  const opensOnNameHere = (sentence: string): boolean =>
    names.some(
      (name) =>
        sentence.slice(0, name.length).toLowerCase() === name.toLowerCase() &&
        /^\s+here\b/i.test(sentence.slice(name.length)),
    )
  const isOpener = (sentence: string): boolean =>
    sentence.length <= 160 &&
    (SELF_INTRO.test(sentence) ||
      NAME_HERE.test(sentence) ||
      opensOnNameHere(sentence)) &&
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
  rest = fillSenderPlaceholders(ungreeted, senderName).trim()

  if (mode === 'ensure' && !replacedOpener && namesSender(rest)) return rest
  if (!rest) return intro
  return `${intro} ${trimmedStart ? capitalizeFirst(rest) : rest}`
}

// For a body that may already be fine: returned untouched when it names the
// sender with no placeholder, repaired otherwise.
export const ensureSmsIdentification = (
  body: string,
  context: SmsIdentificationContext,
): string => identify(body, context, 'ensure')

// For a fresh AI draft, which must open on the surface's own intro: any
// introduction the model wrote is replaced rather than kept beneath it.
export const openWithSmsIdentification = (
  body: string,
  context: SmsIdentificationContext,
): string => identify(body, context, 'open')

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
    [greeting, withoutLockedLines(body, committeeName).trim()]
      .filter(Boolean)
      .join(' '),
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

// The line in its own paragraph, just above the opt-out.
const placeAboveOptOut = (script: string, line: string): string => {
  const optOutAt =
    [...script.matchAll(new RegExp(OPT_OUT_SENTENCE.source, 'gi'))].pop()
      ?.index ?? -1
  if (optOutAt === -1) return `${script.trimEnd()}\n\n${line}`
  const before = script.slice(0, optOutAt).trimEnd()
  const lead = before === '' ? '' : `${before}\n\n`
  return `${lead}${line}\n\n${script.slice(optOutAt)}`
}

// Exactly one copy of the line, just above the opt-out. A message that
// already carries one there (an earlier wording included) is left as it is;
// any other copy, wherever it sits, goes.
const withOnePanelLine = (
  script: string,
  line: string,
  found: { text: string } | null,
  patterns: RegExp[],
): string => {
  const stripped = removeEvery(script, patterns)
  if (found && placeAboveOptOut(stripped, found.text) === script) return script
  return placeAboveOptOut(stripped, line)
}

// Adds or removes the civic panel ask. It is its own paragraph just above the
// opt-out, so the explanation reads apart from both the body and STOP.
export const withCivicPanelJoin = (script: string, on: boolean): string =>
  on
    ? withOnePanelLine(
        script,
        CIVIC_PANEL_JOIN_LINE,
        findCivicPanelJoinLine(script),
        JOIN_LINE_PATTERNS,
      )
    : removeEvery(script, JOIN_LINE_PATTERNS)

// Adds or removes the civic panel LEAVE line, which a text to panel members
// alone carries in the JOIN line's place: its own paragraph just above the
// opt-out. Adding it drops any JOIN line, so a message never carries both.
export const withCivicPanelLeave = (script: string, on: boolean): string =>
  on
    ? withOnePanelLine(
        removeEvery(script, JOIN_LINE_PATTERNS),
        CIVIC_PANEL_LEAVE_LINE,
        findCivicPanelLeaveLine(script),
        LEAVE_LINE_PATTERNS,
      )
    : removeEvery(script, LEAVE_LINE_PATTERNS)

// The civic panel line a message should carry: LEAVE on a text to panel
// members alone, otherwise JOIN when the ask is on, otherwise neither.
export const withCivicPanelLines = (
  script: string,
  lines: { join: boolean; leave: boolean },
): string =>
  lines.leave
    ? withCivicPanelLeave(script, true)
    : withCivicPanelJoin(withCivicPanelLeave(script, false), lines.join)

// --- The managed civic panel invite ----------------------------------------
//
// GoodParty texts one invite in the official's name until their panel is
// built. They edit only its body; the JOIN line and the opt-out are locked
// under it, so the composed invite always ends on exactly those two lines.

// The draft body, greeting included. `office` has been through
// `grammarizeOfficeName` ("Maplewood City Council Member").
export const managedInviteDraft = ({
  firstName,
  office,
}: {
  firstName: string
  office: string
}): string =>
  `Hi {{first_name}}, this is ${firstName || SERVE_SMS_IDENTIFICATION_FALLBACK.name}, ` +
  `your ${office || SERVE_SMS_IDENTIFICATION_FALLBACK.office}. I'm putting ` +
  'together a group of residents I check with before big votes. Want in?'

// The invite as sent: the body, then the JOIN line and the opt-out. A body
// that echoes either locked line loses it, so neither is ever sent twice.
export const composeManagedInvite = (body: string): string =>
  withCivicPanelJoin(
    `${withoutLockedLines(body).trim()}\n\n${OPT_OUT_FOOTER}`,
    true,
  )

// The editable body of an invite an AI rewrite handed back whole.
export const managedInviteBody = (invite: string): string =>
  withoutLockedLines(invite).trim()

// What follows the editable body, shown locked under it.
export const MANAGED_INVITE_LOCKED_LINES = `${CIVIC_PANEL_JOIN_LINE} ${OPT_OUT_FOOTER}`

// --- Add it back ------------------------------------------------------------
//
// A required line the official deleted is put back where the flow writes it,
// with one click, so nobody has to retype it to our punctuation.

// The opt-out closes the message: after the civic panel line, and on the
// "Paid for by" line when the message ends on one, as composeFooter writes it.
export const addOptOutBack = (message: string): string => {
  const kept = message.trimEnd()
  if (kept === '') return OPT_OUT_FOOTER
  const lastLine = kept.slice(kept.lastIndexOf('\n') + 1)
  return /^Paid for by /i.test(lastLine)
    ? `${kept} ${OPT_OUT_FOOTER}`
    : `${kept}\n\n${OPT_OUT_FOOTER}`
}

// The greeting opens the message, so each person sees their own first name.
export const addGreetingBack = (message: string, greeting: string): string =>
  `${greeting} ${message.trimStart()}`

// The disclaimer goes back just before the opt-out on the closing line.
export const addPaidForByBack = (
  message: string,
  committeeName: string,
): string => {
  const line = paidForByLine(committeeName)
  const optOut = [...message.matchAll(/reply\s+["'“”‘’]?stop\b/gi)].pop()
  if (optOut?.index === undefined) return `${message.trimEnd()}\n\n${line}`
  return `${message.slice(0, optOut.index)}${line} ${message.slice(optOut.index)}`
}

// The identification goes back as the first sentence, right after the
// greeting when the message still opens with it.
export const addIdentificationBack = (
  message: string,
  { greeting, intro }: { greeting: string; intro: string },
): string => {
  const text = message.trimStart()
  if (!text.startsWith(greeting)) return `${intro} ${text}`
  const rest = text.slice(greeting.length).trimStart()
  return `${greeting} ${intro}${rest ? ` ${rest}` : ''}`
}

export const IMAGE_MAX_BYTES = 500000
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif'

const PROFILE_PHOTO_MAX_EDGE = 1024
const PROFILE_PHOTO_QUALITIES = [0.85, 0.7, 0.5]

// A photo from Android's photo picker is a handle Chrome re-reads only when
// the review step uploads it, and that late read can fail: the create then
// dies in the browser and nothing reaches gp-api. Copying the bytes at pick
// time uploads from memory, and an unreadable photo fails while the
// candidate can still choose it again. Rejects when the file can't be read.
export const inMemoryCopy = (file: File): Promise<File> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new File([reader.result], file.name, { type: file.type }))
      } else {
        reject(new Error('Image read returned no bytes'))
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })

// The profile photo the SMS image starts from. Avatars are stored at up to
// 5 MB, ten times what an MMS attachment allows, so anything over the cap or
// in another format is redrawn as a JPEG. Null on any failure: the dropzone
// is still there, so a missing prefill only costs the candidate one upload.
export const profilePhotoFile = async (url: string): Promise<File | null> => {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    if (
      IMAGE_ACCEPT.split(',').includes(blob.type) &&
      blob.size <= IMAGE_MAX_BYTES
    ) {
      const extension = blob.type.split('/')[1] ?? 'jpeg'
      return new File([blob], `profile-photo.${extension}`, {
        type: blob.type,
      })
    }
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(
      1,
      PROFILE_PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height),
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas
      .getContext('2d')
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    for (const quality of PROFILE_PHOTO_QUALITIES) {
      const jpeg = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      )
      if (jpeg && jpeg.size <= IMAGE_MAX_BYTES) {
        return new File([jpeg], 'profile-photo.jpeg', { type: 'image/jpeg' })
      }
    }
    return null
  } catch {
    return null
  }
}

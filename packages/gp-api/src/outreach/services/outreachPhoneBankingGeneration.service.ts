import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import {
  PHONE_BANKING_SCRIPT_MAX_LENGTH,
  PhoneBankingScriptPurpose,
  type RaceTargetMetrics,
  ServePhoneBankingPurpose,
  SocialTone,
  VOTER_NAME_TOKEN,
} from '@goodparty_org/contracts'
import { isValid } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import {
  DateFormats,
  formatDate,
  isDateTodayOrFuture,
  parseIsoDateString,
} from '@/shared/util/date.util'
import { Campaign } from '../../generated/prisma'
import { TONE_STYLES } from '../util/messageTone.util'

// The per-surface voice a draft/improve request writes in. Win and Serve
// share every other piece of the generation pipeline (the LLM call
// plumbing, the custom-purpose fresh-generation refusal, the length
// safety-net) — only the purpose copy and these prompts vary.
// purposePrompts is the FULL instruction block for a purpose — the
// product CSV's prompt text, verbatim, for both surfaces — injected into
// the context as-is.
export interface PhoneBankingVoiceConfig<TPurpose extends string> {
  purposePrompts: Record<TPurpose, string>
  draftSystemPrompt: string
  improveSystemPrompt: string
  openerRule: string
  nameLabel: string
  officeLabel: string
  subjectFallback: string
  // What buildPreviousDraftBlock calls the source of "supporting details"
  // in the regenerate-variation rule — Win's own campaign materials vs.
  // the elected official's own materials for Serve.
  materialsLabel: string
}

interface DraftInput<TPurpose extends string> {
  purpose: TPurpose
  tone: SocialTone
  currentDraft?: string
  previousDraft?: string
  instructions?: string
}

// Product/politics prompt copy (CSV phonebank-script-prompts, 2026-08-31),
// transcribed VERBATIM — do not editorialize, fix grammar, or reflow.
// Supersedes the launch-era PURPOSE_GOALS/PURPOSE_STRUCTURE one-liners.
// The `custom` entry is the improve-path copy (candidate-authored text is
// adapted, never freshly generated — see generateDraft's custom guard).
//
// Source-material mapping (prompt term -> context block; "not modeled"
// means no context builder emits it today, so the invention ban is what
// keeps the model from fabricating it):
//   candidate's name / office sought  -> nameLabel/officeLabel lines
//   motto/tagline                     -> not modeled (lives on the
//                                        candidate website, not compose
//                                        context)
//   bio / why-they're-running         -> CampaignStory.background ("The
//   statement                            candidate's campaign story, in
//                                        their own words") — Win has one
//                                        combined story field, not two
//   platform priorities               -> customIssues ("The candidate's
//                                        stated issue positions")
//   accomplishments                   -> not modeled
//   event name/date/time/location     -> not modeled by context; carried
//                                        via the candidate's own
//                                        instructions field when given
//   early-voting window / election    -> buildDateContext below (grounded
//   day date                             from campaign.details + a live
//                                        milestones fetch, vote-early only)
const WIN_PURPOSE_PROMPTS: Record<PhoneBankingScriptPurpose, string> = {
  introduce_myself:
    'Write a phonebank voter ID script for a volunteer introducing the ' +
    'candidate to a voter for the first time. This is an identification ' +
    'call, not a persuasion call, the goal is a respectful first ' +
    'contact, not winning them over in one conversation. Format as ' +
    'alternating You:/Voter: lines with a realistic example response. ' +
    "Open with a warm, brief rapport beat: confirm you've reached the " +
    'right person, introduce yourself by name as a volunteer for ' +
    '[candidate], and a genuine one-line check-in. Briefly introduce ' +
    'the candidate using their name, office sought, and motto/tagline ' +
    'if provided, in a sentence or two, not a speech. Ask one simple, ' +
    "low-pressure question, such as whether they're familiar with the " +
    'candidate or leaning toward supporting them, and show an example ' +
    'response. Thank the voter regardless of their answer. Do not ' +
    'invent facts not present in the source material. Do not reference ' +
    'party affiliation or use inflammatory language. Close with a ' +
    'brief, warm sign-off. Keep the whole call short, under about 60 ' +
    'seconds of talk time, since voter ID calls work best when quick ' +
    'and respectful, with deeper persuasion happening on a separate ' +
    'call. Keep the language conversational and natural throughout.',
  persuade_voters:
    'Write a phonebank persuasion script for a volunteer talking with ' +
    'an undecided voter. Format as alternating You:/Voter: lines. Open ' +
    'with a brief rapport beat, then ask an open-ended question about ' +
    'what matters most to the voter in this election (not a yes/no ' +
    'question) and show a realistic example response. Have the ' +
    'volunteer reflect back what the voter said to show they were ' +
    'actually listening, before connecting it, briefly and only where ' +
    "a genuine and true connection exists, to the candidate's bio, " +
    "why-they're-running statement, accomplishments, or platform " +
    'priorities, drawing only on the source material provided. Do not ' +
    'invent facts. Do not reference party affiliation, attack or name ' +
    'opponents, or use inflammatory language. Close with one clear, ' +
    "specific ask for the voter's support and vote, not a vague hope. " +
    'Keep the tone conversational and unhurried, this call is meant to ' +
    'build genuine understanding, not deliver a pitch, so favor ' +
    'listening over talking.',
  event_invite:
    'Write a phonebank script for a volunteer inviting a voter to a ' +
    'campaign event. Format as alternating You:/Voter: lines. Open ' +
    'with a brief rapport beat, then state the event name, date, ' +
    "time, and location as provided, and briefly explain why it's " +
    'worth attending. Include an example of the voter asking a ' +
    'natural follow-up question (e.g. about parking or bringing a ' +
    'friend) with a model answer where that detail is available. ' +
    'After the primary ask to attend, include one soft secondary ask ' +
    'appropriate to a campaign event, such as bringing a friend or ' +
    'considering volunteering, without pressuring them if they decline ' +
    'the first ask. Do not invent event details not provided. Avoid ' +
    'inflammatory language. Close by thanking them for their time ' +
    'regardless of their answer.',
  early_voting:
    'Write a phonebank script for a volunteer helping a voter make a ' +
    'specific plan to vote early, not just reminding them early ' +
    'voting exists. Format as alternating You:/Voter: lines. Open ' +
    'with a brief rapport beat, then let the voter know early voting ' +
    'is open. Instead of only stating how and where to vote early, ' +
    "walk through a plan with them: ask when they're thinking of " +
    'going, and offer help such as a polling location lookup or ' +
    'transportation if that information is available. Use inclusive, ' +
    "collective language (e.g. 'we want to make sure you have a " +
    "plan') rather than directive language. Include an example of the " +
    'voter answering with a specific plan, or asking a follow-up ' +
    'question, with a model response. Do not invent voting logistics ' +
    'not provided. Avoid inflammatory language. Close by confirming ' +
    'their plan, asking for their support of the candidate as part of ' +
    'that plan, and thanking them.',
  election_day_turnout:
    "Write a phonebank script confirming a known supporter's vote on " +
    'election day. This call should be noticeably shorter and more ' +
    'direct than the other scripts, election day calls work best when ' +
    'brief and to the point. Format as alternating You:/Voter: lines, ' +
    'no more than three exchanges. Open with a quick identity ' +
    'confirmation, remind them polls close at a specific time (using ' +
    "the detail provided), and ask directly whether they've voted " +
    "yet. Include one example each of a 'yes, already voted' response " +
    "and a 'not yet' response, with a model reply for each, offering " +
    "help getting to the polls in the 'not yet' case if that " +
    'information is available. Do not invent voting logistics not ' +
    'provided. Avoid inflammatory language. Keep the entire call ' +
    'short enough to read aloud in under a minute, and close with a ' +
    'quick, warm thank-you regardless of their answer.',
  custom:
    "Take the candidate's own message, provided as written, and adapt " +
    'it into a natural phonebank call script formatted as alternating ' +
    'You:/Voter: lines. Preserve the substance and wording of the ' +
    'original message as closely as possible; do not add new claims, ' +
    'priorities, or asks not present in the original. Add only the ' +
    'conversational scaffolding needed to make it sound like a real ' +
    'call (a rapport-building opener, natural transitions, and a ' +
    'plausible example voter response), not new substantive content. ' +
    'Flag rather than silently alter or remove anything in the ' +
    'original message that reads awkwardly or inappropriately for a ' +
    'live phone conversation.',
}

const VOLUNTEER_OPENER_RULE =
  'The volunteer opener is the first line of every script and is spoken ' +
  'by the VOLUNTEER, in their own first person, never the candidate: ' +
  `"Hi, is this ${VOTER_NAME_TOKEN}? My name is [your name], and I am a ` +
  'volunteer for" followed by the candidate name given below. Keep ' +
  `"[your name]" and "${VOTER_NAME_TOKEN}" as literal bracketed ` +
  'placeholders — never invent a volunteer name or a voter name.'

const COMPLIANCE_BAN_RULE =
  'NEVER include SMS or robocall compliance lines: no "Reply STOP", no ' +
  '"Paid for by", and no callback phone number. This is a live script a ' +
  'volunteer reads to a voter on the phone, not a text or recorded ' +
  'message.'

// Product decision (ENG-10932): no bracket placeholders beyond
// "[your name]" — ground real election/early-voting dates where we have
// them (see the date context below) and write around the gap in plain
// language where we don't, the same way the social drafts handle missing
// specifics. Amended by ENG-10938: the voter-name token is also allowed
// in the opener, interpolated with the active contact's first name on
// the caller page.
const NO_PLACEHOLDER_BRACKETS_RULE =
  'Never emit a bracketed placeholder anywhere in the script other than ' +
  `"[your name]" and "${VOTER_NAME_TOKEN}" in the volunteer opener. ` +
  'Where a specific date, time, or place is not given below, write ' +
  'around the gap in plain language instead of inventing one or ' +
  'leaving a bracket for a volunteer to fill in.'

const ELECTION_DATE_DISAMBIGUATION_RULE =
  'If more than one election date is given below (for example a primary ' +
  'and a general), ground the call in whichever one is the next ' +
  'upcoming election — never combine or confuse the two.'

// ENG-10970: the dialogue-format purpose copy (ENG-10990) runs longer than
// the old prose scripts, and a purpose like "persuade" now regularly
// crosses PHONE_BANKING_SCRIPT_MAX_LENGTH. State an explicit budget with
// headroom below the wire cap so the model stops itself on a clean
// dialogue turn instead of relying on trimDraftToDialogueBoundary's
// safety-net cut. Shared by Win and Serve — both surfaces use the same
// You:/Voter: dialogue format and wire cap.
const SCRIPT_LENGTH_BUDGET_HEADROOM = 200
const SCRIPT_LENGTH_RULE =
  'Keep the entire script under ' +
  `${PHONE_BANKING_SCRIPT_MAX_LENGTH - SCRIPT_LENGTH_BUDGET_HEADROOM} ` +
  'characters total, across every You:/Voter: line combined, and end on ' +
  'a complete dialogue turn — never stop mid-sentence or mid-word.'

// ENG-10936: instructions personalize the draft but never outrank the
// grounding/compliance/token rules above — named explicitly so the model
// treats them as a floor the candidate's ask cannot punch through.
const INSTRUCTIONS_PRIORITY_RULE =
  "If the candidate's own instructions are given below, follow them as " +
  'long as they do not conflict with the rules above — never invent a ' +
  'date, place, or fact even if instructed to, and never drop the ' +
  `volunteer opener or the "[your name]"/"${VOTER_NAME_TOKEN}" tokens.`

const DRAFT_SYSTEM_PROMPT = [
  'You are a campaign writing assistant helping an independent,',
  'non-partisan local candidate draft one phone-banking call script for',
  'volunteers to read to voters.',
  'Rules:',
  `- ${VOLUNTEER_OPENER_RULE}`,
  '- Ground the why-statement, issues, and any specifics in the',
  "  candidate's own campaign materials when they are provided; never",
  '  invent policy positions, issue stances, endorsements, statistics,',
  '  dates, places, or events the materials do not contain. With no',
  '  materials, stay issue-neutral.',
  '- Follow the purpose instructions given below for this call,',
  '  including their You:/Voter: dialogue format and closing.',
  `- ${SCRIPT_LENGTH_RULE}`,
  `- ${COMPLIANCE_BAN_RULE}`,
  `- ${NO_PLACEHOLDER_BRACKETS_RULE}`,
  `- ${ELECTION_DATE_DISAMBIGUATION_RULE}`,
  `- ${INSTRUCTIONS_PRIORITY_RULE}`,
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone.',
].join('\n')

const IMPROVE_SYSTEM_PROMPT = [
  'You are a campaign writing assistant helping an independent,',
  'non-partisan local candidate polish one phone-banking call script',
  'they or a volunteer wrote themselves.',
  'This is a light edit, NOT a rewrite. Rules:',
  '- Every concrete detail in the original MUST appear in your output:',
  '  the volunteer opener, dates, deadlines, places, events, times,',
  '  names, numbers, and asks. Dropping one is a failure. Do not',
  '  paraphrase specifics away.',
  `- The literal "[your name]" and "${VOTER_NAME_TOKEN}" placeholders in`,
  '  the volunteer opener MUST be preserved exactly.',
  '- Strip any other bracketed placeholder the original contains (for',
  '  example "[early voting dates]" or "[polling location]") and',
  '  rewrite around the gap in plain language instead — never leave it',
  '  as a bracket, and never invent a specific date, time, or place to',
  '  fill it.',
  '- Fix grammar, punctuation, capitalization, and awkward phrasing;',
  "  keep the author's meaning, structure, and voice.",
  '- Preserve the You:/Voter: alternating dialogue format.',
  '- Keep roughly the same length as the original and do not add new',
  "  sentences it does not have, UNLESS the candidate's own instructions",
  '  below explicitly ask for additions — then make the instructed',
  '  additions instead of holding to this length rule.',
  '- Never add policy positions, issue stances, endorsements,',
  '  statistics, dates, places, or events the original text does not',
  '  contain — campaign materials, when provided, are context for tone',
  '  and accuracy, not a source of new content in a polish.',
  `- ${COMPLIANCE_BAN_RULE} Remove any that appear in the original.`,
  `- ${INSTRUCTIONS_PRIORITY_RULE}`,
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone through word choice, not new content.',
].join('\n')

export const WIN_PHONE_BANKING_VOICE: PhoneBankingVoiceConfig<PhoneBankingScriptPurpose> =
  {
    purposePrompts: WIN_PURPOSE_PROMPTS,
    draftSystemPrompt: DRAFT_SYSTEM_PROMPT,
    improveSystemPrompt: IMPROVE_SYSTEM_PROMPT,
    openerRule: VOLUNTEER_OPENER_RULE,
    nameLabel: 'Candidate name',
    officeLabel: 'Office sought',
    subjectFallback: 'The candidate',
    materialsLabel: 'campaign materials',
  }

// The serve purpose prompts are the product CSV's copy (2026-08-31),
// verbatim — do not paraphrase or "improve" it. Each is a full,
// self-contained instruction block (rapport beat, per-purpose recipe,
// invention ban, closing), injected as-is instead of a goal+structure
// pair. "Voter:" is the CSV's own dialogue speaker label — format, not
// candidate/voter framing.
const SERVE_PURPOSE_PROMPTS: Record<ServePhoneBankingPurpose, string> = {
  introduce_myself:
    'Write a phonebank script for a volunteer or staffer introducing ' +
    'the elected official to a constituent for the first time. Format ' +
    'as alternating You:/Voter: lines. Open with a warm, brief rapport ' +
    "beat before introducing the official's name, office held, and " +
    'why-they-serve statement in a sentence or two. Ask an open-ended ' +
    'question about what issues matter most to the constituent, and ' +
    'show an example of them sharing something with a brief, genuine ' +
    'acknowledgment in response, not a pivot into a pitch. Do not ' +
    'invent facts not present in the source material. Do not reference ' +
    'party affiliation or use inflammatory language. Close by thanking ' +
    "them and inviting them to follow the official's updates or reach " +
    'out anytime. Keep the whole call brief and low-pressure, the goal ' +
    'of a first constituent contact is building a relationship, not ' +
    'delivering a message.',
  explain_decision:
    'Write a phonebank script for a volunteer or staffer explaining a ' +
    'recent decision or vote made by the elected official and the ' +
    'reasoning behind it. Format as alternating You:/Voter: lines. ' +
    'Open with a brief rapport beat, then state the decision plainly ' +
    'and explain the reasoning in 2-3 plain-language sentences using ' +
    'only the details provided, avoiding jargon. Include an example of ' +
    'the constituent reacting, whether a question, a concern, or ' +
    'agreement, with a calm, non-defensive model response. Do not ' +
    'invent facts, outcomes, or justifications not present in the ' +
    'source material. Do not attack colleagues or other officials, and ' +
    'avoid inflammatory language. Close by inviting further questions ' +
    'or feedback and thanking them for their time. Keep this call ' +
    'short and transparent in tone, informing rather than persuading.',
  event_invite:
    'Write a phonebank script for a volunteer or staffer inviting a ' +
    'constituent to a town hall or local event. Format as alternating ' +
    'You:/Voter: lines. Open with a brief rapport beat, then state the ' +
    'event name, date, time, and location as provided, and briefly ' +
    'explain why it matters (e.g. a chance to ask questions directly ' +
    'or weigh in on a local issue). Include an example follow-up ' +
    'question from the constituent with a model answer where ' +
    'information is available. Do not invent event details not ' +
    'provided. Avoid inflammatory language. Close by asking if they ' +
    'can make it and thanking them regardless of their answer.',
  community_input:
    'Write a phonebank script for a volunteer or staffer inviting a ' +
    'constituent to share input on a local issue or upcoming decision. ' +
    'Format as alternating You:/Voter: lines. Open with a brief ' +
    'rapport beat, then name the issue or decision using the details ' +
    'provided and ask an open-ended question inviting the constituent ' +
    'to share their perspective, not a yes/no question. Include an ' +
    'example of the constituent sharing a concern, with the caller ' +
    'reflecting it back to show they heard it, rather than immediately ' +
    'pivoting to a response or solution. Do not invent details not ' +
    'provided. Avoid inflammatory language. Close by thanking them and ' +
    'letting them know their input will be passed along. Keep the tone ' +
    'unhurried and listening-focused throughout, this call is meant to ' +
    'hear from them, not to persuade or inform.',
  share_resource:
    'Write a phonebank script for a volunteer or staffer telling a ' +
    'constituent about a local program, service, or resource available ' +
    'to them. Format as alternating You:/Voter: lines. Open with a ' +
    'brief rapport beat, then introduce the resource using the details ' +
    'provided in plain language, explain who it helps and how to ' +
    'access it, and include an example of the constituent asking a ' +
    'natural follow-up question with a model answer. Do not invent ' +
    'details not provided. Avoid inflammatory language. Close by ' +
    "asking if they'd like more information sent to them and thanking " +
    'them for their time. Keep this call informational and ' +
    'low-pressure, not persuasive.',
  custom:
    "Take the elected official's own message, provided as written, " +
    'and adapt it into a natural phonebank call script formatted as ' +
    'alternating You:/Voter: lines. Preserve the substance and wording ' +
    'of the original message as closely as possible; do not add new ' +
    'claims, priorities, or asks not present in the original. Add only ' +
    'the conversational scaffolding needed to make it sound like a ' +
    'real call, not new substantive content. Flag rather than ' +
    'silently alter or remove anything in the original message that ' +
    'reads awkwardly or inappropriately for a live phone conversation.',
}

const SERVE_OPENER_RULE =
  'The opener is the first line of every script and is spoken by the ' +
  'VOLUNTEER or staffer making the call, in their own first person, on ' +
  'behalf of the elected official, never the elected official ' +
  `themselves: "Hi, is this ${VOTER_NAME_TOKEN}? My name is [your ` +
  'name], and I am calling on behalf of" followed by the elected ' +
  'official name given below. Keep "[your name]" and ' +
  `"${VOTER_NAME_TOKEN}" as literal bracketed placeholders — never ` +
  'invent a volunteer name or a constituent name.'

const SERVE_COMPLIANCE_BAN_RULE =
  'NEVER include SMS or robocall compliance lines: no "Reply STOP", no ' +
  '"Paid for by", and no callback phone number. This is a live script ' +
  'a volunteer reads to a constituent on the phone, not a text or ' +
  'recorded message.'

const SERVE_NO_PLACEHOLDER_BRACKETS_RULE =
  'Never emit a bracketed placeholder anywhere in the script other ' +
  `than "[your name]" and "${VOTER_NAME_TOKEN}" in the opener. Where a ` +
  'specific date, time, or place is not given below, write around the ' +
  'gap in plain language instead of inventing one or leaving a bracket ' +
  'for a volunteer to fill in.'

const SERVE_INSTRUCTIONS_PRIORITY_RULE =
  "If the elected official's own instructions are given below, follow " +
  'them as long as they do not conflict with the rules above — never ' +
  'invent a date, place, or fact even if instructed to, and never ' +
  `drop the opener or the "[your name]"/"${VOTER_NAME_TOKEN}" tokens.`

const SERVE_DRAFT_SYSTEM_PROMPT = [
  'You are a writing assistant helping a local elected official draft',
  'one phonebank call script for a volunteer or staffer to read to a',
  'constituent.',
  'Rules:',
  `- ${SERVE_OPENER_RULE}`,
  '- Ground the why-they-serve statement, decisions, and any specifics',
  "  in the elected official's own materials when they are provided;",
  '  never invent facts, decisions, endorsements, statistics, dates,',
  '  places, or events the materials do not contain. With no',
  '  materials, stay general.',
  '- Follow the purpose instructions given below for this call,',
  '  including their You:/Voter: dialogue format and closing.',
  `- ${SCRIPT_LENGTH_RULE}`,
  `- ${SERVE_COMPLIANCE_BAN_RULE}`,
  `- ${SERVE_NO_PLACEHOLDER_BRACKETS_RULE}`,
  `- ${SERVE_INSTRUCTIONS_PRIORITY_RULE}`,
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone.',
].join('\n')

const SERVE_IMPROVE_SYSTEM_PROMPT = [
  'You are a writing assistant helping a local elected official polish',
  'one phonebank call script they or a volunteer wrote themselves.',
  'This is a light edit, NOT a rewrite. Rules:',
  '- Every concrete detail in the original MUST appear in your output:',
  '  the opener, dates, deadlines, places, events, times, names,',
  '  numbers, and asks. Dropping one is a failure. Do not paraphrase',
  '  specifics away.',
  `- The literal "[your name]" and "${VOTER_NAME_TOKEN}" placeholders`,
  '  in the opener MUST be preserved exactly.',
  '- Strip any other bracketed placeholder the original contains and',
  '  rewrite around the gap in plain language instead — never leave it',
  '  as a bracket, and never invent a specific date, time, or place to',
  '  fill it.',
  '- Fix grammar, punctuation, capitalization, and awkward phrasing;',
  "  keep the author's meaning, structure, and voice.",
  '- Preserve the You:/Voter: alternating dialogue format.',
  '- Keep roughly the same length as the original and do not add new',
  "  sentences it does not have, UNLESS the elected official's own",
  '  instructions below explicitly ask for additions — then make the',
  '  instructed additions instead of holding to this length rule.',
  '- Never add facts, decisions, endorsements, statistics, dates,',
  '  places, or events the original text does not contain — the',
  "  official's own materials, when provided, are context for tone",
  '  and accuracy, not a source of new content in a polish.',
  `- ${SERVE_COMPLIANCE_BAN_RULE} Remove any that appear in the`,
  '  original.',
  `- ${SERVE_INSTRUCTIONS_PRIORITY_RULE}`,
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone through word choice, not new content.',
].join('\n')

export const SERVE_PHONE_BANKING_VOICE: PhoneBankingVoiceConfig<ServePhoneBankingPurpose> =
  {
    purposePrompts: SERVE_PURPOSE_PROMPTS,
    draftSystemPrompt: SERVE_DRAFT_SYSTEM_PROMPT,
    improveSystemPrompt: SERVE_IMPROVE_SYSTEM_PROMPT,
    openerRule: SERVE_OPENER_RULE,
    nameLabel: 'Elected official name',
    officeLabel: 'Office held',
    subjectFallback: 'The elected official',
    materialsLabel: "official's own materials",
  }

// No max() here: an instructions-driven or near-cap improve result can land
// a few chars over PHONE_BANKING_SCRIPT_MAX_LENGTH, and a hard max would
// fail Zod validation -> caught -> 502 (an unrecoverable error from a
// recoverable output). Robocall hit this exact bug — see
// outreachRobocallGeneration.service.ts. Truncate at the boundary below
// instead; the response schema still enforces the cap at the wire.
const DraftSchema = z.object({
  draft: z.string().min(1),
})

// Delimited the same way currentDraft is (a triple-quote fence) so the
// model reads it as quoted candidate text, not further instructions to the
// prompt itself.
const buildInstructionsBlock = <TPurpose extends string>(
  instructions: string,
  voice: PhoneBankingVoiceConfig<TPurpose>,
): string[] => [
  `${voice.subjectFallback}'s own instructions for this draft — follow ` +
    'them as long as they do not conflict with the rules above:',
  '"""',
  instructions,
  '"""',
]

// Kept generic (parametrized by voice.subjectFallback/materialsLabel)
// rather than duplicated per surface — everything but the subject and the
// materials phrase is identical prose for both surfaces. For Win this must
// stay byte-identical to the pre-refactor literal text (see
// outreachPhoneBanking.test.ts's previousDraft assertions).
const lowerFirst = (value: string): string =>
  value.charAt(0).toLowerCase() + value.slice(1)

const buildPreviousDraftBlock = <TPurpose extends string>(
  previousDraft: string,
  voice: PhoneBankingVoiceConfig<TPurpose>,
): string[] => [
  `The script ${lowerFirst(voice.subjectFallback)} just rejected:`,
  '"""',
  previousDraft,
  '"""',
  `${voice.subjectFallback} rejected this draft. Write a noticeably ` +
    'different script: a different opening after the volunteer opener, ' +
    'different sentence rhythm, and different supporting details from ' +
    `the ${voice.materialsLabel}. Do not reuse its distinctive phrases.`,
]

// Safety net for a result that lands over PHONE_BANKING_SCRIPT_MAX_LENGTH
// despite the SCRIPT_LENGTH_RULE budget above (see the no-max() comment on
// DraftSchema for why this can't be a Zod validation instead). A raw
// `.slice()` cuts mid-word or mid-sentence — this cuts at the last complete
// dialogue turn instead, falling back a step at a time when the draft
// doesn't offer that boundary. Exported for unit testing.
export const trimDraftToDialogueBoundary = (
  draft: string,
  maxLength: number,
): string => {
  if (draft.length <= maxLength) return draft

  const truncated = draft.slice(0, maxLength)

  const lastNewline = truncated.lastIndexOf('\n')
  const atLine =
    lastNewline > 0 ? truncated.slice(0, lastNewline).trimEnd() : ''
  if (atLine.length > 0) return atLine

  const atWord = truncated.replace(/\s+\S*$/, '').trimEnd()
  if (atWord.length > 0) return atWord

  return truncated
}

// Mirrors filingInstructions.util's formatFilingDate: these date strings
// come from the same details/BR writers, so an unparseable value must not
// throw and 500 the draft request — fall back to the raw string instead.
const formatElectionDate = (value: string): string => {
  const parsed = parseIsoDateString(value)
  return isValid(parsed) ? formatDate(parsed, DateFormats.usDate) : value
}

@Injectable()
export class OutreachPhoneBankingGenerationService {
  constructor(
    private readonly llm: LlmService,
    private readonly campaigns: CampaignsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachPhoneBankingGenerationService.name)
  }

  async generateDraft<TPurpose extends string>(
    input: DraftInput<TPurpose>,
    name: string,
    office: string,
    userId: string,
    extraContext: string[],
    voice: PhoneBankingVoiceConfig<TPurpose>,
  ): Promise<string> {
    // Fresh generation only: improve mode polishes the author's own
    // words, so it applies to custom-purpose scripts too.
    if (input.purpose === 'custom' && !input.currentDraft) {
      throw new BadRequestException(
        'Custom-purpose scripts are written by the user',
      )
    }
    const context = [
      `${voice.nameLabel}: ${name || voice.subjectFallback}.`,
      `${voice.officeLabel}: ${office || 'local office'}.`,
      voice.purposePrompts[input.purpose],
      `Tone: ${TONE_STYLES[input.tone]}`,
      ...extraContext,
    ]
    // custom's improve path ADAPTS plain prose into You:/Voter: dialogue
    // plus new scaffolding (opener, transitions, an example response) —
    // the opposite of improveSystemPrompt's light-edit/same-length/
    // format-already-there constraints. Borrow draftSystemPrompt instead:
    // it defers to the purpose instructions below (which carry the adapt
    // copy) and imposes no length or format-preservation rule to conflict
    // with them.
    const isCustomAdapt = input.purpose === 'custom' && !!input.currentDraft
    const messages: LlmMessage[] = input.currentDraft
      ? [
          {
            role: 'system',
            content: isCustomAdapt
              ? voice.draftSystemPrompt
              : voice.improveSystemPrompt,
          },
          {
            role: 'user',
            content: [
              ...context,
              // Surface-neutral wording (never "candidate"/"official") so
              // the shared path doesn't leak Win framing onto Serve — see
              // the isCustomAdapt system-prompt swap above for why custom
              // needs its own framing here too: "polish"/"the script"
              // implies a light edit of an existing call script, which
              // contradicts custom's adapt-into-dialogue-plus-scaffolding
              // instructions.
              isCustomAdapt
                ? 'The message to adapt, as written:'
                : 'The existing call script to polish:',
              '"""',
              input.currentDraft,
              '"""',
              isCustomAdapt
                ? 'Adapt the message into a call script.'
                : 'Polish the script.',
              ...(input.instructions
                ? buildInstructionsBlock(input.instructions, voice)
                : []),
            ].join('\n'),
          },
        ]
      : [
          { role: 'system', content: voice.draftSystemPrompt },
          {
            role: 'user',
            content: [
              ...context,
              ...(input.previousDraft
                ? buildPreviousDraftBlock(input.previousDraft, voice)
                : []),
              'Write the call script.',
              ...(input.instructions
                ? buildInstructionsBlock(input.instructions, voice)
                : []),
            ].join('\n'),
          },
        ]

    try {
      const { object } = await this.llm.jsonCompletion({
        messages,
        schema: DraftSchema,
        // High enough that Regenerate re-rolls produce a different draft.
        temperature: 0.8,
        maxTokens: 1024,
        userId,
      })
      // Safety net for a slightly-over-limit result (see DraftSchema above).
      return trimDraftToDialogueBoundary(
        object.draft,
        PHONE_BANKING_SCRIPT_MAX_LENGTH,
      )
    } catch (err) {
      this.logger.error({ err }, 'Phone banking script generation failed')
      throw new BadGatewayException('Phone banking script generation failed')
    }
  }

  // Win-only grounding: the election date / early-voting window from real
  // data only (ENG-10932) — never an estimate. Serve purposes carry no
  // voting mechanics, so the serve controller never calls this and never
  // reads campaign.details. The election date lives on the campaign row
  // already; the early-voting window is a live BR fetch, so it's only
  // worth making for the purpose that uses it.
  async buildDateContext(
    purpose: PhoneBankingScriptPurpose,
    campaign: Campaign,
  ): Promise<string[]> {
    const blocks: string[] = []
    const { electionDate, primaryElectionDate } = campaign.details
    // A date that has already passed is no longer a live date to call
    // about — only ground either date while it's still upcoming.
    if (electionDate && isDateTodayOrFuture(electionDate)) {
      blocks.push(`Election day: ${formatElectionDate(electionDate)}.`)
    }
    if (primaryElectionDate && isDateTodayOrFuture(primaryElectionDate)) {
      blocks.push(
        `Primary election day: ${formatElectionDate(primaryElectionDate)}.`,
      )
    }

    if (purpose !== 'early_voting') return blocks

    // Milestones are grounding enrichment, same as office resolution in
    // the controller — a fetch failure must not fail the draft.
    let metrics: RaceTargetMetrics | null = null
    try {
      metrics = await this.campaigns.fetchLiveRaceTargetMetrics(campaign)
    } catch (err) {
      this.logger.warn({ err }, 'race milestones fetch failed for draft')
    }
    const earlyVoting = metrics?.milestones?.early_voting
    const start = earlyVoting?.start
      ? formatElectionDate(earlyVoting.start)
      : null
    const end = earlyVoting?.end ? formatElectionDate(earlyVoting.end) : null
    if (start && end) {
      blocks.push(`Early voting window: ${start} through ${end}.`)
    } else if (start) {
      blocks.push(`Early voting starts: ${start}.`)
    } else if (end) {
      blocks.push(`Early voting ends: ${end}.`)
    }
    return blocks
  }
}

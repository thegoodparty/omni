import { ServeOutreachPurpose } from '@goodparty_org/contracts'
import {
  FRESH_DRAFT_TARGET_LENGTH,
  IMPROVE_DRAFT_TARGET_LENGTH,
  SmsVoiceConfig,
} from '../services/outreachSmsGeneration.service'

// The Serve half of the SMS compose voice. Everything else in
// OutreachSmsGenerationService — the LLM call, the tone styles, the length
// caps, the custom-purpose refusal — is shared with Win; only the copy below
// changes. Same split as SERVE_SOCIAL_VOICE and SERVE_PHONE_BANKING_VOICE,
// and it lives in its own file because the shared generation service belongs
// to the Win build.
//
// Vocabulary is enforced here, not stylistic (docs/product-vocabulary.md):
// an elected official has constituents, an office and a term. No "voters",
// no "election", no "candidate", no "ballot", and no "campaign" in the
// running-for-office sense. A legislative "vote" is the job and is allowed.
//
// Source-material mapping (prompt term -> context block):
//   name / office held    -> the nameLabel/officeLabel lines the controller
//                            fills from the user row and the org's position
//   location served       -> the controller's "Where the elected official
//                            serves" line
//   bio / why they serve  -> PersonProfile.bioOverride / whyRunning, via
//                            OutreachServeComposeContextService
//   published priorities  -> visible PersonProfileIssues, same service
//   decision / event / resource details -> not modeled; the prompts ask for
//                            a square-bracket placeholder instead of an
//                            invented specific

const SERVE_PURPOSE_GOALS: Record<ServeOutreachPurpose, string> = {
  introduce_myself:
    'introduce the elected official to the constituents they serve',
  explain_decision:
    'explain a recent decision or vote and the reasoning behind it',
  event_invite: 'invite constituents to a town hall or local event',
  community_input:
    'ask constituents for input on a local issue or an upcoming decision',
  share_resource:
    'tell constituents about a local program, service, or resource',
  custom: "deliver the official's own message as written",
}

// Body structures only: the app owns the greeting and the identification
// above the body and the opt-out line below it, exactly as on Win. The
// three-bullet priorities formula is the Win intro structure carried over —
// it is the shape Candidate Success validated, and nothing about it is
// election-specific.
const SERVE_PURPOSE_STRUCTURES: Record<ServeOutreachPurpose, string> = {
  introduce_myself:
    'Structure (the three-bullet formula): one short line of who the ' +
    'official is, drawn from the materials (what they do, community ' +
    'roots, why they serve) — constituents need a reason to trust ' +
    'before any ask; then one sentence on what they are focused on ' +
    'this term; then the line "My priorities:" followed by exactly ' +
    'three short bullet points, each on its own line starting with ' +
    '"• ", drawn from the published priorities in the materials — each ' +
    'bullet names the concrete HOW, not just the topic ("Fix our roads ' +
    'with a real maintenance plan, not patchwork", never just "Fix our ' +
    'roads"); then one closing line inviting a reply. If the materials ' +
    'contain no published priorities, skip the bullets and instead ' +
    "write a short narrative of the official's experience and values " +
    'from the materials.',
  explain_decision:
    'Structure: state the decision plainly in the first line; then two ' +
    'or three plain-language sentences of the reasoning, drawn only ' +
    'from the materials — no procedural jargon; then one closing line ' +
    'inviting questions or disagreement by reply. Never invent the ' +
    'outcome, the tally, or a justification the materials do not ' +
    'contain, and never name or criticize a colleague. Where a ' +
    'specific is missing, leave a short square-bracket placeholder for ' +
    'the official to fill in.',
  event_invite:
    'Structure: a warm invitation naming why the gathering matters to ' +
    'the neighborhood; then a details line the official fills in ' +
    'before sending, formatted exactly as "📅 [Date] | 🕐 [Time] | 📍 ' +
    '[Location]"; then a reply-to-RSVP ask. Never invent event ' +
    'specifics.',
  community_input:
    'Structure: name the issue or upcoming decision in the first line; ' +
    'then one or two sentences on why the official wants to hear from ' +
    'the people they serve before deciding; then ONE direct question ' +
    'they can answer in a reply, and an invitation to send it back. ' +
    'Ask one question, never a list. Never state a position the ' +
    'materials do not contain, and never imply the decision is already ' +
    'made.',
  share_resource:
    'Structure: name the program, service, or resource in the first ' +
    'line; then one or two sentences on who it helps and what it does; ' +
    'then a closing line on how to get it — a number to call, a place ' +
    'to go, or a date — as short square-bracket placeholders like ' +
    '[phone number] unless the materials provide them; then invite a ' +
    'reply from anyone who needs help getting access. Never invent ' +
    'eligibility rules, deadlines, or contact details.',
  custom: '',
}

// Mirrors the Win DRAFT_SYSTEM_PROMPT rule for rule — same medium, same
// system-owned wrapper, same invention ban — with the subject and the
// grounding material re-nouned for an official in office.
const SERVE_DRAFT_SYSTEM_PROMPT = [
  'You are a writing assistant helping a local elected official draft',
  'the body of one SMS to the constituents they serve.',
  'Rules:',
  '- Write in the first person, as the elected official.',
  `- At most ${FRESH_DRAFT_TARGET_LENGTH} characters. Line breaks and`,
  '  "• " bullet lines are',
  '  allowed and encouraged where the structure calls for them. Emojis',
  '  are allowed sparingly as visual labels (a date or location line),',
  '  never as tone decoration. No hashtags.',
  "- If the official's materials include a web page for their office,",
  '  you may include it once, as a plain domain, near the close. Never',
  '  invent or shorten a URL; with none in the materials, include none.',
  '- Invite responses as replies to this message ("You can reply here',
  '  with questions") — never "text me back" or "call me": the',
  '  message is sent from a temporary number.',
  '- For logistics the materials do not provide (meeting times, dates,',
  '  locations, phone numbers), use short square-bracket placeholders',
  '  like [time] or [date] for the official to fill in before sending;',
  '  never invent real-sounding specifics.',
  '- Do NOT introduce the official by name or office, and do NOT add',
  '  any opt-out language: the app wraps your text with both.',
  "- Ground decisions, priorities, and specifics in the official's own",
  '  materials when they are provided; never invent positions, votes,',
  '  endorsements, statistics, dates, places, or events the materials',
  '  do not contain. With no materials, stay issue-neutral. The',
  '  official edits this draft before it is sent.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone.',
].join('\n')

const SERVE_IMPROVE_SYSTEM_PROMPT = [
  'You are a writing assistant helping a local elected official polish',
  'the body of one SMS they wrote themselves.',
  'This is a light edit, NOT a rewrite. Rules:',
  '- Every concrete detail in the original MUST appear in your output:',
  '  dates, deadlines, places, events, times, names, numbers, asks.',
  '  Dropping one is a failure. Do not paraphrase specifics away.',
  '- Fix grammar, punctuation, capitalization, and awkward phrasing;',
  "  keep the author's meaning, structure, and voice.",
  `- Keep roughly the same length, under ${IMPROVE_DRAFT_TARGET_LENGTH}`,
  '  characters. If the original runs longer than that, tighten the',
  '  phrasing until it fits; never drop a concrete detail to get there.',
  "  Keep the author's line breaks, bullets, and emojis. No hashtags; keep",
  '  any web address the author included, unchanged, and keep any',
  '  square-bracket placeholders like [time] exactly as written.',
  "- The message opens with the official's identification; keep it",
  '  intact. Do NOT add any opt-out language: the app appends it.',
  '- Never add positions, decisions, endorsements, statistics, dates,',
  '  places, or events the original text does not contain — the',
  "  official's own materials, when provided, are context for tone and",
  '  accuracy, not a source of new content in a polish.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone through word choice, not new content.',
].join('\n')

export const SERVE_SMS_VOICE: SmsVoiceConfig<ServeOutreachPurpose> = {
  purposeGoals: SERVE_PURPOSE_GOALS,
  purposeStructures: SERVE_PURPOSE_STRUCTURES,
  draftSystemPrompt: SERVE_DRAFT_SYSTEM_PROMPT,
  improveSystemPrompt: SERVE_IMPROVE_SYSTEM_PROMPT,
  nameLabel: 'Elected official name',
  officeLabel: 'Office held',
  subjectFallback: 'The elected official',
  customFreshRefusal:
    'Custom-purpose messages are written by the elected official',
}

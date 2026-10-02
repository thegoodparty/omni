import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import {
  checkSmsStandards,
  deriveSmsProtectedParts,
  type MergeTagChannel,
  type OutreachEventDetails,
  SMS_COMPOSED_MAX_LENGTH,
  SmsPurpose,
  type SmsStandardsRule,
  SocialTone,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import {
  maskProtectedParts,
  PROTECTED_MARKER_RULE,
  restoreProtectedParts,
} from '../util/smsProtectedImprove.util'

// What the composer locks in the message an Improve request carries, so the
// model can be kept away from it: the same inputs checkSmsStandards takes at
// scheduling, plus the surface's merge-tag form and the rules it ignores.
export interface SmsImproveProtection {
  candidateNames: string[]
  committeeName: string | null
  channel: MergeTagChannel
  ignoredRules: SmsStandardsRule[]
}

// One retry: a reply that drops or reorders a marker is usually a one-off,
// and a second miss is better reported than looped on.
const IMPROVE_ATTEMPTS = 2
import { eventDetailsContext } from '../util/eventDetails.util'

// The per-surface voice a draft/improve request writes in. Win and Serve
// share every other piece of this pipeline (the LLM call plumbing, the tone
// styles, the custom-purpose fresh-generation refusal, the length caps) —
// only the purpose copy, the two system prompts and the subject nouns vary.
// Same shape as SocialVoiceConfig and PhoneBankingVoiceConfig. The Serve
// config is SERVE_SMS_VOICE in `../util/serveSmsVoice.util.ts`; it lives in
// its own file rather than beside WIN_SMS_VOICE below only because this file
// is shared and the Serve build owns that one.
export interface SmsVoiceConfig<TPurpose extends string> {
  // One clause naming what the message is for, read into the context as
  // "Goal of this message: ...".
  purposeGoals: Record<TPurpose, string>
  // The BODY structure for a fresh draft, injected only when there is no
  // currentDraft. An empty string means no structure (the custom purpose,
  // which is improve-only).
  purposeStructures: Record<TPurpose, string>
  draftSystemPrompt: string
  improveSystemPrompt: string
  nameLabel: string
  officeLabel: string
  // Also the subject noun in the improve user turn, so the shared path never
  // says "candidate" to a Serve request.
  subjectFallback: string
  // The 400 for a fresh custom-purpose request, which has no author text to
  // work from on either surface.
  customFreshRefusal: string
}

interface SmsDraftInput<TPurpose extends string> {
  purpose: TPurpose
  tone: SocialTone
  currentDraft?: string
  event?: OutreachEventDetails
}

const PURPOSE_GOALS: Record<SmsPurpose, string> = {
  introduce_myself: 'introduce the candidate to voters',
  persuade_voters: 'persuade likely voters to support the candidate',
  event_invite: 'invite people to a local event',
  early_voting: 'encourage voters to vote early',
  election_day_turnout: 'encourage voters to turn out on election day',
  custom: "deliver the candidate's own message as written",
}

// The Candidate Success message structures (2026-09-08, refined per CS
// feedback 2026-09-09), transcribed from the team's published intro-text
// templates — the CS input the phase-2 TDD left as an open question. Each
// structure describes only the BODY: the app owns the greeting and
// identification above it and the disclosures below.
const PURPOSE_STRUCTURES: Record<SmsPurpose, string> = {
  introduce_myself:
    'Structure (the three-bullet formula): one short line of who the ' +
    'candidate is, drawn from the materials (occupation, family, ' +
    'community roots) — voters need a reason to trust before any ask; ' +
    'then one sentence of vision; then the line "My priorities:" ' +
    'followed by exactly three short bullet points, each on its own ' +
    'line starting with \"• \", drawn from the stated priorities in ' +
    'the materials — each bullet names the concrete HOW, not just the ' +
    'topic (\"Fix our roads with a real maintenance plan, not ' +
    'patchwork\", never just \"Fix our roads\"); then one closing ' +
    'line inviting a reply. If the materials contain no stated ' +
    'priorities, skip the bullets and instead write a short narrative ' +
    "of the candidate's experience and values from the materials.",
  persuade_voters:
    'Structure: one line on what sets the candidate apart (independent, ' +
    'not beholden to special interests — only as supported by the ' +
    'materials); then "My priorities:" with up to three "• " ' +
    'bullet lines of stated priorities from the materials, each with ' +
    'its concrete HOW, at the same specificity an intro message would ' +
    'use; then a direct invitation to reply and ask how the candidate ' +
    'will be different.',
  event_invite:
    'Structure: a warm invitation naming why the gathering matters; ' +
    'then one details line with the event details given below, ' +
    'formatted as "📅 <date> | 🕐 <time> | 📍 <location>"; leave the ' +
    'line out entirely if no event details are given; then a ' +
    'reply-to-RSVP ask. Never invent event specifics.',
  early_voting:
    'Structure (the early-voting text): lead with the fact that early ' +
    'voting is underway and why local races matter; ask directly for ' +
    'their vote; then one line "My focus: ..." listing two or three ' +
    'stated priorities from the materials; then a logistics line with ' +
    'poll hours and the early-voting end date, only as the materials ' +
    'give them, leaving out whatever they do not; close by encouraging ' +
    'them to make a plan to vote.',
  election_day_turnout:
    'Structure: lead with election day being here and why local races ' +
    'matter; ask directly for their vote; then one line "My focus: ' +
    '...\" listing two or three stated priorities from the materials; ' +
    'then a deadline line with the poll closing time, only if the ' +
    'materials give it; close by urging them to the polls today.',
  custom: '',
}

const TONE_STYLES: Record<SocialTone, string> = {
  warm:
    'Warm: caring and personal. Lead with connection to neighbors and ' +
    'community; gentle, encouraging language.',
  direct:
    'Direct: plain and to the point. Short sentences, a clear ask, no ' +
    'filler or hedging.',
  urgent:
    'Urgent: time matters. Convey momentum and a now-or-never stake ' +
    'without being alarmist.',
  friendly:
    'Friendly: upbeat and approachable. Conversational, light, like a ' +
    'note to a friend.',
}

// The prompts ask for these lengths; the schema below does not enforce them.
// The webapp counts the composed message (greeting + body + footer) and
// blocks Continue past SMS_COMPOSED_MAX_LENGTH, so the server only refuses
// a body that could never fit even bare. A tighter schema turned a polish of
// an already-long draft into four identical retries and a 502 — nine of them
// in the two weeks to 2026-09-22 — where the counter would have shown the
// candidate the overage and let them trim.
export const FRESH_DRAFT_TARGET_LENGTH = 700
export const IMPROVE_DRAFT_TARGET_LENGTH = 800

// Every text must say who is sending it (the candidate_name standard in
// contracts' checkSmsStandards). The webapp owns that sentence, opening a
// fresh draft on it and locking the name in it, so the model must neither
// write its own (it would read as a second introduction) nor stand in for the
// name with a bracket the sender has to notice and fill. Shared by Win and
// Serve, so it names neither a candidate nor an official.
export const SMS_NO_NAME_PLACEHOLDER_RULE = [
  "- Never write a placeholder for anyone's name, such as [Your Name],",
  '  [Name] or [your name].',
].join('\n')

export const SMS_IMPROVE_IDENTIFICATION_RULE = [
  "- The message opens with the sender's identification: their name and",
  '  office. Keep it word for word. Never swap the name for a placeholder',
  '  like [Your Name], and do not add a second greeting, introduction, or',
  '  sign-off.',
].join('\n')

// The flow wraps the body in system-owned regions (identification intro
// and opt-out footer), so the model must produce ONLY the middle and
// leave headroom inside the composed cap. The structure and length rules
// follow the CS message templates (2026-09-08).
const DRAFT_SYSTEM_PROMPT = [
  'You are a campaign writing assistant helping an independent,',
  'non-partisan local candidate draft the body of one SMS to voters.',
  'Rules:',
  '- Write in the first person, as the candidate.',
  `- At most ${FRESH_DRAFT_TARGET_LENGTH} characters. Line breaks and`,
  '  \"• \" bullet lines are',
  '  allowed and encouraged where the structure calls for them. Emojis',
  '  are allowed sparingly as visual labels (a date or location line),',
  '  never as tone decoration. No hashtags.',
  "- If the campaign materials include the campaign's website, you may",
  '  include it once, as a plain domain, near the close. Never invent',
  '  or shorten a URL; with no website in the materials, include none.',
  '- Invite responses as replies to this message (\"You can reply here',
  '  with questions\") — never \"text me back\" or \"call me\": the',
  '  message is sent from a temporary campaign number.',
  '- Never write a square-bracket placeholder. Logistics (poll hours,',
  '  dates, times, locations) come only from the event details or the',
  '  materials; leave out any they do not give, and never invent',
  '  real-sounding specifics.',
  '- Do NOT introduce the candidate by name or office, do not greet, and',
  '  do not sign off: the app has ALREADY opened the text with "Hello',
  '  <first name>, this is <name>, candidate for <office>." Start with',
  '  substance.',
  SMS_NO_NAME_PLACEHOLDER_RULE,
  '- Do NOT add any opt-out or paid-for-by language: the app appends',
  '  both.',
  "- Ground positions, issues, and specifics in the candidate's own",
  '  campaign materials when they are provided; never invent policy',
  '  positions, issue stances, endorsements, statistics, dates, places,',
  '  or events the materials do not contain. With no materials, stay',
  '  issue-neutral. The candidate edits this draft before it is used.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone.',
].join('\n')

const IMPROVE_SYSTEM_PROMPT = [
  'You are a campaign writing assistant helping an independent,',
  'non-partisan local candidate polish one SMS they wrote themselves.',
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
  '  any website the author included, unchanged, and keep any',
  '  square-bracket placeholders like [time] exactly as written.',
  PROTECTED_MARKER_RULE,
  SMS_IMPROVE_IDENTIFICATION_RULE,
  '- Never add policy positions, issue stances, endorsements,',
  '  statistics, dates, places, or events the original text does not',
  '  contain — campaign materials, when provided, are context for tone',
  '  and accuracy, not a source of new content in a polish.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone through word choice, not new content.',
].join('\n')

export const WIN_SMS_VOICE: SmsVoiceConfig<SmsPurpose> = {
  purposeGoals: PURPOSE_GOALS,
  purposeStructures: PURPOSE_STRUCTURES,
  draftSystemPrompt: DRAFT_SYSTEM_PROMPT,
  improveSystemPrompt: IMPROVE_SYSTEM_PROMPT,
  nameLabel: 'Candidate name',
  officeLabel: 'Office sought',
  subjectFallback: 'The candidate',
  customFreshRefusal: 'Custom-purpose messages are written by the candidate',
}

const DraftSchema = z.object({
  draft: z.string().min(1).max(SMS_COMPOSED_MAX_LENGTH),
})

@Injectable()
export class OutreachSmsGenerationService {
  constructor(
    private readonly llm: LlmService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachSmsGenerationService.name)
  }

  // The Win entry point, unchanged: same five arguments, same strings out.
  // A defaulted `voice` parameter would need an unsafe cast to satisfy the
  // generic below, so Win's voice is bound here instead.
  generateDraft(
    input: SmsDraftInput<SmsPurpose>,
    candidateName: string,
    office: string,
    userId: string,
    campaignContext: string[] = [],
    protection?: SmsImproveProtection,
  ): Promise<string> {
    return this.generateDraftWithVoice(
      input,
      candidateName,
      office,
      userId,
      campaignContext,
      WIN_SMS_VOICE,
      protection,
    )
  }

  // Shared by Win and Serve; the voice carries everything that differs.
  async generateDraftWithVoice<TPurpose extends string>(
    input: SmsDraftInput<TPurpose>,
    name: string,
    office: string,
    userId: string,
    composeContext: string[],
    voice: SmsVoiceConfig<TPurpose>,
    protection?: SmsImproveProtection,
  ): Promise<string> {
    // Fresh generation only: improve mode polishes the author's own
    // words, so it applies to custom-purpose messages too.
    if (input.purpose === 'custom' && !input.currentDraft) {
      throw new BadRequestException(voice.customFreshRefusal)
    }
    const context = [
      `${voice.nameLabel}: ${name || voice.subjectFallback}.`,
      `${voice.officeLabel}: ${office || 'local office'}.`,
      `Goal of this message: ${voice.purposeGoals[input.purpose]}.`,
      // Fresh drafts only: improve is a polish that keeps the author's
      // structure, and a prescriptive shape in the user turn would
      // override the improve prompt's keep-their-structure rule.
      ...(!input.currentDraft && voice.purposeStructures[input.purpose]
        ? [voice.purposeStructures[input.purpose]]
        : []),
      ...(!input.currentDraft
        ? eventDetailsContext(input.purpose, input.event)
        : []),
      `Tone: ${TONE_STYLES[input.tone]}`,
      ...composeContext,
    ]
    if (input.currentDraft) {
      return this.improveProtected(
        input.currentDraft,
        context,
        voice,
        userId,
        protection,
      )
    }

    const messages: LlmMessage[] = [
      { role: 'system', content: voice.draftSystemPrompt },
      {
        role: 'user',
        content: [...context, 'Write the SMS body.'].join('\n'),
      },
    ]
    try {
      const { object } = await this.llm.jsonCompletion({
        messages,
        schema: DraftSchema,
        // High enough that Regenerate re-rolls produce a different draft.
        temperature: 0.8,
        maxTokens: 512,
        userId,
      })
      return object.draft
    } catch (err) {
      this.logger.error({ err }, 'SMS draft generation failed')
      throw new BadGatewayException('SMS draft generation failed')
    }
  }

  // Improve polishes the WHOLE message the candidate is looking at, locked
  // parts included, so those parts are masked before the model sees them and
  // the reply is used only if it restores cleanly. It also may not fail a
  // compliance rule the original passed: a polish that breaks compliance is
  // worse than no polish. Either way out is a 502, which the composer
  // already reports as "try again", never a changed disclaimer.
  private async improveProtected<TPurpose extends string>(
    currentDraft: string,
    context: string[],
    voice: SmsVoiceConfig<TPurpose>,
    userId: string,
    protection: SmsImproveProtection | undefined,
  ): Promise<string> {
    if (!protection) {
      // Every caller passes it; a missing one is a wiring bug, and polishing
      // unprotected text is exactly what this path exists to prevent.
      throw new BadRequestException('Improve needs the message protection')
    }
    const standards = (script: string) =>
      checkSmsStandards(script, protection).failures.filter(
        (rule) => !protection.ignoredRules.includes(rule),
      )
    const failingBefore = new Set(standards(currentDraft))
    const { masked, locked } = maskProtectedParts(
      currentDraft,
      deriveSmsProtectedParts(currentDraft, protection),
    )
    const messages: LlmMessage[] = [
      { role: 'system', content: voice.improveSystemPrompt },
      {
        role: 'user',
        content: [
          ...context,
          `${voice.subjectFallback}'s SMS to polish:`,
          '"""',
          masked,
          '"""',
          // The message as sent, not as masked: the markers are shorter than
          // the text they hold, which is restored before anyone sees it.
          ...(currentDraft.length > IMPROVE_DRAFT_TARGET_LENGTH
            ? [
                `The original runs ${currentDraft.length} ` +
                  'characters; bring it under ' +
                  `${IMPROVE_DRAFT_TARGET_LENGTH} without dropping a ` +
                  'detail.',
              ]
            : []),
          'Polish the message.',
        ].join('\n'),
      },
    ]

    for (let attempt = 1; attempt <= IMPROVE_ATTEMPTS; attempt++) {
      let reply: string
      try {
        const { object } = await this.llm.jsonCompletion({
          messages,
          schema: DraftSchema,
          temperature: 0.8,
          maxTokens: 512,
          userId,
        })
        reply = object.draft
      } catch (err) {
        this.logger.error({ err }, 'SMS draft generation failed')
        throw new BadGatewayException('SMS draft generation failed')
      }
      const restored = restoreProtectedParts(reply, locked)
      if (restored === null) {
        this.logger.warn({ attempt }, 'SMS improve dropped a locked part')
        continue
      }
      const newlyFailing = standards(restored).filter(
        (rule) => !failingBefore.has(rule),
      )
      if (newlyFailing.length > 0) {
        this.logger.warn(
          { attempt, newlyFailing },
          'SMS improve broke a compliance rule',
        )
        continue
      }
      return restored
    }
    throw new BadGatewayException('SMS draft generation failed')
  }
}

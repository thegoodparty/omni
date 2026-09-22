import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import {
  SMS_COMPOSED_MAX_LENGTH,
  SmsDraftRequest,
  SmsPurpose,
  SocialTone,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'

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
    'then a details line the candidate fills in before sending, ' +
    'formatted exactly as \"📅 [Date] | 🕐 [Time] | 📍 [Location]\"; then a ' +
    'reply-to-RSVP ask. Never invent event specifics.',
  early_voting:
    'Structure (the early-voting text): lead with the fact that early ' +
    'voting is underway and why local races matter; ask directly for ' +
    'their vote; then one line "My focus: ..." listing two or three ' +
    'stated priorities from the materials; then a logistics line with ' +
    'poll hours and the early-voting end date — as \"[hours]\" and ' +
    '\"[date]\" placeholders unless the materials provide them; close ' +
    'by encouraging them to make a plan to vote.',
  election_day_turnout:
    'Structure: lead with election day being here and why local races ' +
    'matter; ask directly for their vote; then one line "My focus: ' +
    '...\" listing two or three stated priorities from the materials; ' +
    'then a deadline line with the poll closing time — as a ' +
    '\"[time]\" placeholder unless the materials provide it; close by ' +
    'urging them to the polls today.',
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
const FRESH_DRAFT_TARGET_LENGTH = 700
const IMPROVE_DRAFT_TARGET_LENGTH = 800

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
  '- For logistics the materials do not provide (poll hours, dates,',
  '  times, locations), use short square-bracket placeholders like',
  '  [time] or [date] for the candidate to fill in before sending;',
  '  never invent real-sounding specifics.',
  '- Do NOT introduce the candidate by name or office, and do NOT add',
  '  any opt-out or paid-for-by language: the app wraps your text with',
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
  'non-partisan local candidate polish the body of one SMS they wrote',
  'themselves.',
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
  "- The message opens with the candidate's identification; keep it",
  '  intact. Do NOT add any opt-out language: the app appends it.',
  '- Never add policy positions, issue stances, endorsements,',
  '  statistics, dates, places, or events the original text does not',
  '  contain — campaign materials, when provided, are context for tone',
  '  and accuracy, not a source of new content in a polish.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone through word choice, not new content.',
].join('\n')

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

  async generateDraft(
    input: SmsDraftRequest,
    candidateName: string,
    office: string,
    userId: string,
    campaignContext: string[] = [],
  ): Promise<string> {
    // Fresh generation only: improve mode polishes the candidate's own
    // words, so it applies to custom-purpose messages too.
    if (input.purpose === 'custom' && !input.currentDraft) {
      throw new BadRequestException(
        'Custom-purpose messages are written by the candidate',
      )
    }
    const context = [
      `Candidate name: ${candidateName || 'The candidate'}.`,
      `Office sought: ${office || 'local office'}.`,
      `Goal of this message: ${PURPOSE_GOALS[input.purpose]}.`,
      // Fresh drafts only: improve is a polish that keeps the author's
      // structure, and a prescriptive shape in the user turn would
      // override the improve prompt's keep-their-structure rule.
      ...(!input.currentDraft && PURPOSE_STRUCTURES[input.purpose]
        ? [PURPOSE_STRUCTURES[input.purpose]]
        : []),
      `Tone: ${TONE_STYLES[input.tone]}`,
      ...campaignContext,
    ]
    const messages: LlmMessage[] = input.currentDraft
      ? [
          { role: 'system', content: IMPROVE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              ...context,
              "The candidate's SMS body to polish:",
              '"""',
              input.currentDraft,
              '"""',
              ...(input.currentDraft.length > IMPROVE_DRAFT_TARGET_LENGTH
                ? [
                    `The original runs ${input.currentDraft.length} ` +
                      'characters; bring it under ' +
                      `${IMPROVE_DRAFT_TARGET_LENGTH} without dropping a ` +
                      'detail.',
                  ]
                : []),
              'Polish the message.',
            ].join('\n'),
          },
        ]
      : [
          { role: 'system', content: DRAFT_SYSTEM_PROMPT },
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
}

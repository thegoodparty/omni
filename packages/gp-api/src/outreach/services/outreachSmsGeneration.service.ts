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

// The flow wraps the body in system-owned regions (identification intro
// and opt-out footer), so the model must produce ONLY the middle and
// leave headroom inside the composed 480-char UI cap.
const DRAFT_SYSTEM_PROMPT = [
  'You are a campaign writing assistant helping an independent,',
  'non-partisan local candidate draft the body of one SMS to voters.',
  'Rules:',
  '- Write in the first person, as the candidate.',
  '- At most 300 characters of plain text. No links, no hashtags, no',
  '  emojis, no line breaks.',
  '- Do NOT introduce the candidate by name or office, and do NOT add',
  '  any opt-out language: the app wraps your text with both.',
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
  '- Keep roughly the same length; never exceed 340 characters. No',
  '  links, hashtags, emojis, or line breaks.',
  "- The message opens with the candidate's identification; keep it",
  '  intact. Do NOT add any opt-out language: the app appends it.',
  '- Never add policy positions, issue stances, endorsements,',
  '  statistics, dates, places, or events the original text does not',
  '  contain — campaign materials, when provided, are context for tone',
  '  and accuracy, not a source of new content in a polish.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone through word choice, not new content.',
].join('\n')

// The 480-char composed cap covers greeting + identification intro + body +
// opt-out footer, and the model only writes the body — capping the schema at
// the full 480 let a legal response compose past the Continue limit. Fresh
// drafts get the intro prepended client-side, so they reserve headroom for
// it plus the fixed chrome; improve outputs already contain the intro and
// reserve only the chrome (greeting, blank line, footer ≈ 50 chars). The
// schema is what makes the limit real: jsonCompletion retries on mismatch.
const FRESH_DRAFT_MAX_LENGTH = 340
const IMPROVE_DRAFT_MAX_LENGTH = SMS_COMPOSED_MAX_LENGTH - 50

const FreshDraftSchema = z.object({
  draft: z.string().min(1).max(FRESH_DRAFT_MAX_LENGTH),
})
const ImproveDraftSchema = z.object({
  draft: z.string().min(1).max(IMPROVE_DRAFT_MAX_LENGTH),
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
        schema: input.currentDraft ? ImproveDraftSchema : FreshDraftSchema,
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

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
  '- Stay ISSUE-NEUTRAL: never invent policy positions, issue stances,',
  '  endorsements, statistics, dates, places, or events. The candidate',
  '  edits this draft before it is used.',
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
  '- Do NOT add an introduction of the candidate or any opt-out',
  '  language: the app wraps the text with both.',
  '- Stay ISSUE-NEUTRAL: never add policy positions, issue stances,',
  '  endorsements, statistics, dates, places, or events the original',
  '  does not contain.',
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

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import {
  PHONE_BANKING_SCRIPT_MAX_LENGTH,
  PhoneBankingScriptDraftRequest,
  PhoneBankingScriptPurpose,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import { TONE_STYLES } from '../util/messageTone.util'

const PURPOSE_GOALS: Record<PhoneBankingScriptPurpose, string> = {
  introduce: 'introduce the candidate to a voter for the first time',
  persuade: 'persuade an undecided voter to support the candidate',
  event: 'invite the voter to a campaign event',
  'vote-early': 'remind the voter to vote early and tell them how',
  'election-day': 'remind the voter to vote today and tell them how',
  custom: "deliver the candidate's own message as written",
}

// Structural shape per purpose — separate from PURPOSE_GOALS because the
// vote-early / election-day / persuade requirements are about what the
// script must contain, not why the call is happening.
const PURPOSE_STRUCTURE: Record<PhoneBankingScriptPurpose, string> = {
  introduce:
    'Structure: (1) the volunteer opener, (2) one or two sentences on ' +
    "why the candidate is running, grounded in the candidate's real " +
    "story or top issues, (3) a soft ask for the voter's support.",
  persuade:
    'Structure: (1) the volunteer opener, (2) an issue-ID question ' +
    'asking the voter what matters most to them this election, (3) a ' +
    "bridge connecting whatever the voter might say to the candidate's " +
    "real positions, (4) the ask for the voter's support.",
  event:
    'Structure: (1) the volunteer opener, (2) the reason for the call — ' +
    'inviting the voter to a specific campaign event, (3) the ask to ' +
    'attend.',
  'vote-early':
    'Structure: (1) the volunteer opener, (2) a reminder to vote early, ' +
    '(3) voting logistics as bracketed placeholders for the volunteer ' +
    'to fill in from local materials — "[early voting dates]", ' +
    '"[early voting hours]", "[early voting location]" — never a ' +
    'specific invented date, time, or address, (4) the ask to vote.',
  'election-day':
    'Structure: (1) the volunteer opener, (2) a reminder that today is ' +
    'election day, (3) voting logistics as bracketed placeholders — ' +
    '"[polling hours]", "[polling location]" — never a specific ' +
    'invented time or address, (4) the ask to vote.',
  custom:
    "Structure: deliver the candidate's own message as written, " +
    'polished for a phone script read aloud by a volunteer.',
}

const VOLUNTEER_OPENER_RULE =
  'The volunteer opener is the first line of every script and is spoken ' +
  'by the VOLUNTEER, in their own first person, never the candidate: ' +
  '"Hi, my name is [your name], and I am a volunteer for" followed by ' +
  'the candidate name given below. Keep "[your name]" as a literal ' +
  'bracketed placeholder for the volunteer to fill in — never invent a ' +
  'volunteer name.'

const COMPLIANCE_BAN_RULE =
  'NEVER include SMS or robocall compliance lines: no "Reply STOP", no ' +
  '"Paid for by", and no callback phone number. This is a live script a ' +
  'volunteer reads to a voter on the phone, not a text or recorded ' +
  'message.'

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
  '- Follow the structure given below for this call.',
  `- ${COMPLIANCE_BAN_RULE}`,
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone.',
  '- Keep the script roughly 60-150 words of spoken, conversational',
  '  prose, written to be read aloud (no hashtags, no links, no',
  '  headings).',
].join('\n')

const IMPROVE_SYSTEM_PROMPT = [
  'You are a campaign writing assistant helping an independent,',
  'non-partisan local candidate polish one phone-banking call script',
  'they or a volunteer wrote themselves.',
  'This is a light edit, NOT a rewrite. Rules:',
  '- Every concrete detail in the original MUST appear in your output:',
  '  the volunteer opener, dates, deadlines, places, events, times,',
  '  names, numbers, asks, and any bracketed placeholder. Dropping one',
  '  is a failure. Do not paraphrase specifics away.',
  '- Fix grammar, punctuation, capitalization, and awkward phrasing;',
  "  keep the author's meaning, structure, and voice.",
  '- Keep roughly the same length as the original. Do not add new',
  '  sentences the original does not have.',
  '- Never add policy positions, issue stances, endorsements,',
  '  statistics, dates, places, or events the original text does not',
  '  contain — campaign materials, when provided, are context for tone',
  '  and accuracy, not a source of new content in a polish.',
  `- ${COMPLIANCE_BAN_RULE} Remove any that appear in the original.`,
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone through word choice, not new content.',
].join('\n')

const DraftSchema = z.object({
  draft: z.string().min(1).max(PHONE_BANKING_SCRIPT_MAX_LENGTH),
})

@Injectable()
export class OutreachPhoneBankingGenerationService {
  constructor(
    private readonly llm: LlmService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachPhoneBankingGenerationService.name)
  }

  async generateDraft(
    input: PhoneBankingScriptDraftRequest,
    candidateName: string,
    office: string,
    userId: string,
    campaignContext: string[] = [],
  ): Promise<string> {
    // Fresh generation only: improve mode polishes the candidate's own
    // words, so it applies to custom-purpose scripts too.
    if (input.purpose === 'custom' && !input.currentDraft) {
      throw new BadRequestException(
        'Custom-purpose scripts are written by the candidate',
      )
    }
    const context = [
      `Candidate name: ${candidateName || 'The candidate'}.`,
      `Office sought: ${office || 'local office'}.`,
      `Goal of this call: ${PURPOSE_GOALS[input.purpose]}.`,
      PURPOSE_STRUCTURE[input.purpose],
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
              'The existing call script to polish:',
              '"""',
              input.currentDraft,
              '"""',
              'Polish the script.',
            ].join('\n'),
          },
        ]
      : [
          { role: 'system', content: DRAFT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [...context, 'Write the call script.'].join('\n'),
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
      return object.draft
    } catch (err) {
      this.logger.error({ err }, 'Phone banking script generation failed')
      throw new BadGatewayException('Phone banking script generation failed')
    }
  }
}

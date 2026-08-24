import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import {
  ROBOCALL_SCRIPT_MAX_LENGTH,
  RobocallPurpose,
  RobocallScriptDraftRequest,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import { TONE_STYLES } from '../util/messageTone.util'

const PURPOSE_GOALS: Record<RobocallPurpose, string> = {
  introduce_myself: 'introduce the candidate to voters for the first time',
  persuade_voters: 'persuade a likely voter to support the candidate',
  event_invite: 'invite the voter to a campaign event',
  early_voting: 'encourage the voter to vote early and tell them how',
  election_day_turnout: 'remind the voter to vote today and tell them how',
  custom: "deliver the candidate's own message as written",
}

// Structural shape per purpose — separate from PURPOSE_GOALS because the
// early-voting / election-day / persuade requirements are about what the
// script must contain, not why the call is happening.
const PURPOSE_STRUCTURE: Record<RobocallPurpose, string> = {
  introduce_myself:
    'Structure: (1) the identification opener, (2) one or two sentences ' +
    "on why the candidate is running, grounded in the candidate's real " +
    "story or top issues, (3) a soft ask for the voter's support.",
  persuade_voters:
    'Structure: (1) the identification opener, (2) one or two sentences ' +
    "on the candidate's real positions and why they matter to voters, " +
    "(3) the ask for the voter's support.",
  event_invite:
    'Structure: (1) the identification opener, (2) the reason for the ' +
    'call — inviting the voter to a specific campaign event, (3) the ask ' +
    'to attend.',
  early_voting:
    'Structure: (1) the identification opener, (2) a reminder to vote ' +
    'early, (3) voting logistics as bracketed placeholders for the ' +
    'candidate to fill in from local materials — "[early voting dates]", ' +
    '"[early voting hours]", "[early voting location]" — never a specific ' +
    'invented date, time, or address, (4) the ask to vote.',
  election_day_turnout:
    'Structure: (1) the identification opener, (2) a reminder that today ' +
    'is election day, (3) voting logistics as bracketed placeholders — ' +
    '"[polling hours]", "[polling location]" — never a specific invented ' +
    'time or address, (4) the ask to vote.',
  custom:
    "Structure: deliver the candidate's own message as written, polished " +
    'for a recorded call spoken aloud by the candidate.',
}

// A robocall is the candidate's OWN recorded voice played to a landline, so
// the opener is the candidate self-identifying in first person — the opposite
// of phone banking's volunteer opener. Self-identification is legally required
// for a recorded political call.
const IDENTIFICATION_OPENER_RULE =
  'The identification opener is the first line of every script and is ' +
  'spoken by the CANDIDATE in their own first person: "Hi, this is" ' +
  'followed by the candidate name given below, "and I am running for" ' +
  'followed by the office. Never invent a different name or office.'

// "Paid for by" and any callback number are added by the send pipeline, not
// the spoken script; "Reply STOP" is an SMS concept and never belongs here.
const COMPLIANCE_BAN_RULE =
  'Do NOT include a "Paid for by" line, a callback phone number, or any ' +
  '"Reply STOP"/opt-out text — those are handled separately, and this is a ' +
  'recorded voice message, not a text.'

const LENGTH_RULE =
  'Keep the script to roughly 60-130 words of spoken, conversational ' +
  'prose — a recorded call is capped at 60 seconds, so it must read ' +
  'comfortably inside that when spoken aloud (no hashtags, no links, no ' +
  'headings).'

const DRAFT_SYSTEM_PROMPT = [
  'You are a campaign writing assistant helping an independent,',
  'non-partisan local candidate draft one short robocall script — a',
  'recorded message the candidate reads in their own voice, played to',
  "voters' landlines.",
  'Rules:',
  `- ${IDENTIFICATION_OPENER_RULE}`,
  '- Ground the why-statement, issues, and any specifics in the',
  "  candidate's own campaign materials when they are provided; never",
  '  invent policy positions, issue stances, endorsements, statistics,',
  '  dates, places, or events the materials do not contain. With no',
  '  materials, stay issue-neutral.',
  '- Follow the structure given below for this call.',
  `- ${COMPLIANCE_BAN_RULE}`,
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone.',
  `- ${LENGTH_RULE}`,
].join('\n')

const IMPROVE_SYSTEM_PROMPT = [
  'You are a campaign writing assistant helping an independent,',
  'non-partisan local candidate polish one robocall script they wrote',
  'themselves.',
  'This is a light edit, NOT a rewrite. Rules:',
  '- Every concrete detail in the original MUST appear in your output:',
  '  the identification opener, dates, deadlines, places, events, times,',
  '  names, numbers, asks, and any bracketed placeholder. Dropping one is',
  '  a failure. Do not paraphrase specifics away.',
  '- Fix grammar, punctuation, capitalization, and awkward phrasing;',
  "  keep the author's meaning, structure, and voice.",
  '- Keep roughly the same length as the original. Do not add new',
  '  sentences the original does not have.',
  '- Never add policy positions, issue stances, endorsements, statistics,',
  '  dates, places, or events the original text does not contain —',
  '  campaign materials, when provided, are context for tone and',
  '  accuracy, not a source of new content in a polish.',
  `- ${COMPLIANCE_BAN_RULE} Remove any that appear in the original.`,
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone through word choice, not new content.',
].join('\n')

const DraftSchema = z.object({
  draft: z.string().min(1).max(ROBOCALL_SCRIPT_MAX_LENGTH),
})

@Injectable()
export class OutreachRobocallGenerationService {
  constructor(
    private readonly llm: LlmService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachRobocallGenerationService.name)
  }

  async generateDraft(
    input: RobocallScriptDraftRequest,
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
              'The existing robocall script to polish:',
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
            content: [...context, 'Write the robocall script.'].join('\n'),
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
      this.logger.error({ err }, 'Robocall script generation failed')
      throw new BadGatewayException('Robocall script generation failed')
    }
  }
}

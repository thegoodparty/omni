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
    'Structure: (1) the identification opener, (2) one sentence on why ' +
    "the candidate is running, grounded in the candidate's real story " +
    "or top issues, (3) a soft ask for the voter's support, (4) a brief, " +
    'warm thank-you to close.',
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
  'spoken by the CANDIDATE in their own first person: "This is" followed ' +
  "by the candidate's first name (from the name given below), then " +
  '"candidate for" and the office. Keep it to one short sentence. Never ' +
  'invent a different name or office.'

// With no rented number yet, the spoken script must NOT carry a "Paid for by"
// line or callback number (they need the caller-ID number); "Reply STOP" is an
// SMS concept and never belongs in a recorded call.
const COMPLIANCE_BAN_RULE =
  'Do NOT include a "Paid for by" line, a callback phone number, or any ' +
  '"Reply STOP"/opt-out text — those are handled separately, and this is a ' +
  'recorded voice message, not a text.'

// Once a caller-ID number is rented, the recorded call must carry the spoken
// disclosure the candidate reads: who paid for it, then the callback number.
const DISCLOSURE_RULE =
  'End the script, on its own final line, with the required spoken ' +
  'disclosure in this exact shape: "Paid for by " then the "paid for by" ' +
  'name given below, then a comma, then the callback number given below, ' +
  'written exactly as given (do not spell it out digit by digit). Never ' +
  'add "Reply STOP" or any text-message opt-out — this is a recorded voice ' +
  'call, not a text.'

// Improve mode preserves specifics, so the disclosure reads as keep/add rather
// than write-fresh.
const IMPROVE_DISCLOSURE_RULE =
  'The script must END with the spoken disclosure — who paid for the call ' +
  '(the "paid for by" name given below) and the callback number given ' +
  'below. Keep it if the original has it, add it if missing. Never add ' +
  '"Reply STOP" or any text-message opt-out — this is a recorded voice call.'

const LENGTH_RULE =
  'Keep the whole script short: about 40 to 75 words, four or five short ' +
  'sentences of spoken, conversational prose. A recorded call is capped ' +
  'at 60 seconds, and a shorter call holds attention better (no hashtags, ' +
  'no links, no headings).'

// Format the rented number as a plain grouped US number (XXX-XXX-XXXX,
// dropping a country-code 1) so the drafted disclosure reads "414-485-8077"
// instead of the model spelling out each digit. Falls back to the raw value
// for anything that is not a 10- or 11-digit US number.
const formatCallbackNumber = (raw: string): string => {
  const digits = raw.replace(/\D/g, '')
  const local =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return local.length === 10
    ? `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`
    : raw
}

const draftSystemPrompt = (complianceLine: string): string =>
  [
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
    `- ${complianceLine}`,
    '- Stay strictly non-partisan. No party labels, no attacks.',
    '- Match the requested tone.',
    `- ${LENGTH_RULE}`,
  ].join('\n')

const improveSystemPrompt = (complianceLine: string): string =>
  [
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
    `- ${complianceLine}`,
    '- Stay strictly non-partisan. No party labels, no attacks.',
    '- Match the requested tone through word choice, not new content.',
  ].join('\n')

// No max() here: on the improve path a near-limit currentDraft can grow by a
// few chars, and a hard max would fail Zod validation -> caught -> 502 (an
// unrecoverable error from a recoverable output). We truncate to the cap
// below instead; the contract response schema still enforces it at the wire.
const DraftSchema = z.object({
  draft: z.string().min(1),
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
    const paidForBy =
      candidateName && office
        ? `${candidateName} for ${office}`
        : candidateName || 'the campaign'
    const context = [
      `Candidate name: ${candidateName || 'The candidate'}.`,
      `Office sought: ${office || 'local office'}.`,
      `Goal of this call: ${PURPOSE_GOALS[input.purpose]}.`,
      PURPOSE_STRUCTURE[input.purpose],
      `Tone: ${TONE_STYLES[input.tone]}`,
      ...(input.callbackNumber
        ? [
            `"Paid for by" name: ${paidForBy}.`,
            `Callback number to read aloud: ${formatCallbackNumber(
              input.callbackNumber,
            )}.`,
          ]
        : []),
      ...campaignContext,
    ]
    const draftCompliance = input.callbackNumber
      ? DISCLOSURE_RULE
      : COMPLIANCE_BAN_RULE
    const improveCompliance = input.callbackNumber
      ? IMPROVE_DISCLOSURE_RULE
      : `${COMPLIANCE_BAN_RULE} Remove any that appear in the original.`
    const messages: LlmMessage[] = input.currentDraft
      ? [
          { role: 'system', content: improveSystemPrompt(improveCompliance) },
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
          { role: 'system', content: draftSystemPrompt(draftCompliance) },
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
      // Safety net for a slightly-over-limit improve result (see DraftSchema).
      return object.draft.slice(0, ROBOCALL_SCRIPT_MAX_LENGTH)
    } catch (err) {
      this.logger.error({ err }, 'Robocall script generation failed')
      throw new BadGatewayException('Robocall script generation failed')
    }
  }
}

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import {
  PHONE_BANKING_SCRIPT_MAX_LENGTH,
  PhoneBankingScriptDraftRequest,
  PhoneBankingScriptPurpose,
  type RaceTargetMetrics,
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
    'stating the early-voting window given below when one is provided, ' +
    '(3) if no early-voting window is given, ask the voter to vote ' +
    'early and point them to check their local election office for ' +
    'dates, hours, and locations, instead of stating any, (4) the ask ' +
    'to vote. Never invent a specific date, time, or address that is ' +
    'not given below.',
  'election-day':
    'Structure: (1) the volunteer opener, (2) a reminder that today is ' +
    'election day, stating the election date given below when one is ' +
    'provided, (3) point the voter to check their polling place and ' +
    'hours for their address, instead of stating any, since polling ' +
    'hours and locations are never provided, (4) the ask to vote. ' +
    'Never invent a specific time or address.',
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

// Product decision (ENG-10932): no bracket placeholders beyond
// "[your name]" — ground real election/early-voting dates where we have
// them (see the date context below) and write around the gap in plain
// language where we don't, the same way the social drafts handle missing
// specifics.
const NO_PLACEHOLDER_BRACKETS_RULE =
  'Never emit a bracketed placeholder anywhere in the script other than ' +
  '"[your name]" in the volunteer opener. Where a specific date, time, ' +
  'or place is not given below, write around the gap in plain language ' +
  'instead of inventing one or leaving a bracket for a volunteer to ' +
  'fill in.'

const ELECTION_DATE_DISAMBIGUATION_RULE =
  'If more than one election date is given below (for example a primary ' +
  'and a general), ground the call in whichever one is the next ' +
  'upcoming election — never combine or confuse the two.'

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
  `- ${NO_PLACEHOLDER_BRACKETS_RULE}`,
  `- ${ELECTION_DATE_DISAMBIGUATION_RULE}`,
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
  '  names, numbers, and asks. Dropping one is a failure. Do not',
  '  paraphrase specifics away.',
  '- The literal "[your name]" placeholder in the volunteer opener MUST',
  '  be preserved exactly.',
  '- Strip any other bracketed placeholder the original contains (for',
  '  example "[early voting dates]" or "[polling location]") and',
  '  rewrite around the gap in plain language instead — never leave it',
  '  as a bracket, and never invent a specific date, time, or place to',
  '  fill it.',
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

  async generateDraft(
    input: PhoneBankingScriptDraftRequest,
    candidateName: string,
    office: string,
    userId: string,
    campaign: Campaign,
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
      ...(await this.buildDateContext(input.purpose, campaign)),
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

  // Grounds the election date / early-voting window from real data only
  // (ENG-10932) — never an estimate. The election date lives on the
  // campaign row already; the early-voting window is a live BR fetch, so
  // it's only worth making for the purpose that uses it.
  private async buildDateContext(
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

    if (purpose !== 'vote-early') return blocks

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

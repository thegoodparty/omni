import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import {
  DOOR_KNOCKING_TALKING_POINT_MAX_LENGTH,
  type DoorKnockingTalkingPointsDraftResponse,
  type DoorKnockingTalkingPointsPurpose,
  type ServeDoorKnockingTalkingPointsPurpose,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import { FILTER_DIMENSION_PROVENANCE_RULES } from '@/contacts/filterDimensions.catalog'

// Door-knocking talking points: the five-section card a canvasser reads at a
// door, of which this service writes three lines.
//
// The template is product's own (Door Knocking Script.docx) and the full plan
// is in docs/features/door-knocking-talking-points.md. In short:
//
//   1a Introduction — identity   composed at render
//   1b Introduction — question   GENERATED
//   2  Context                   GENERATED
//   3  Call to action            composed at create from campaign.details
//   4  Ask                       GENERATED
//   5  Departure                 composed at render (a constant)
//
// The split is not about effort. The identity clause is where being wrong
// means a volunteer claiming to be the candidate, and the CTA is where a model
// that can phrase a URL can also invent one. Those two need no judgement to
// get right, so nothing is asked of a model that might get them wrong.

// The rule stated first, because it is the one the other channels' prompts
// would get exactly backwards. Phone banking and SMS produce text a person
// reads out; this produces notes a person reads FROM.
const NOTES_NOT_DIALOGUE_RULE =
  'These are BULLET NOTES a canvasser glances at on a doorstep and then ' +
  'says in their own words — never lines to recite. Do not write ' +
  'dialogue. Do not open with a greeting. Do not address the resident in ' +
  'the second person. Write what the canvasser needs to REMEMBER, not ' +
  'what they should say verbatim.'

// The single highest-leverage sentence in this prompt, lifted from the SMS
// one. The bullet format makes it MORE load-bearing rather than less: a note
// that compresses to "Roads" has told the canvasser nothing and pushes them
// into improvising at a door, which is where false claims come from.
const CONCRETE_HOW_RULE =
  'Name the concrete HOW, not just the topic ("Fix our roads with a real ' +
  'maintenance plan, not patchwork", never just "Fix our roads"). A note ' +
  'that names only a subject is a failure — the canvasser cannot expand it ' +
  'without inventing something.'

// Nouns that differ by rail. Every rule below that names the person is a
// function of these, because a serve prompt that says "candidate" or
// "campaign" has leaked win framing into constituent service — the same
// isolation the serve controller enforces on the data side.
interface SubjectNouns {
  // Possessive, without the article: "candidate's" / "official's".
  possessive: string
  // The prompt block those materials arrive in, so the rule names what the
  // model can actually see.
  materials: string
  // Where the app's composed call-to-action line comes from.
  record: string
}

const WIN_NOUNS: SubjectNouns = {
  possessive: "candidate's",
  materials: 'campaign materials',
  record: "campaign's own record",
}

const SERVE_NOUNS: SubjectNouns = {
  possessive: "official's",
  materials: "official's own materials",
  record: "office's own record",
}

const inventionBanRule = ({ materials }: SubjectNouns): string =>
  `Ground every line in the ${materials} when they are ` +
  'provided; never invent policy positions, issue stances, endorsements, ' +
  'statistics, dates, places, or events the materials do not contain. With ' +
  'no materials, stay issue-neutral and write about listening rather than ' +
  'about positions nobody gave you.'

// The audience block's whole contract. The filter says which of the subject's
// OWN priorities to lead with; it is never a fact about the person who opened
// the door, who was selected by a list and did not volunteer any of it.
// Paired with the catalog's provenance rules, which explain why most of these
// values are estimates in the first place.
const audienceUseRule = ({ possessive }: SubjectNouns): string =>
  `The audience description tells you which of the ${possessive} existing ` +
  'priorities to LEAD WITH. It is NOT a fact about the person who answers ' +
  'the door, and nothing you write may assert, imply, or allude to it — no ' +
  '"as a homeowner", no "for families like yours", no "at your age". The ' +
  'canvasser does not know who is behind the door, and a resident told what ' +
  'a list says about them hears surveillance, not outreach.'

// Lower severity than the channels this comes from — a bracket in a NOTE
// reads as a blank the candidate fills before the walk, not as a stumble
// mid-sentence — but the wizard still highlights unfilled brackets, so the
// rule keeps them scarce and confined to the one line that needs them.
const BRACKETS_RULE =
  'Use a bracketed placeholder ONLY in the ask, and only for event ' +
  'logistics this product does not model: [date], [time], [location]. ' +
  'Never bracket anything else, and never invent a specific date, time or ' +
  'place to avoid one.'

const noLinksRule = ({ record }: SubjectNouns): string =>
  'Never write a URL, a web address, a phone number, or a QR code. The ' +
  `card's call-to-action line is composed from the ${record} ` +
  'and is not yours to write.'

const LENGTH_RULE =
  'Each of the three lines is ONE idea, at most about 30 words. This is ' +
  'read while a door is opening.'

// What every per-purpose steer below has in common, stated once rather than
// nine times. The shape of a door ask is not a per-purpose question: it is
// one thing, answerable where the resident is standing, and small enough
// that "yes" costs them nothing they have to think about. Two asks in one
// line is the common failure — "vote early and take a yard sign" gets a nod
// and neither.
const ASK_RULE =
  'The ask is ONE request and no more, answerable where the resident is ' +
  'standing — nothing to fetch, sign up for, or think over first. Never ' +
  'stack two requests into it. Where the purpose below seeks a commitment, ' +
  'the ask is a yes-or-no the canvasser can record, never softened into a ' +
  'statement. Where the purpose is listening, it is a single question, and ' +
  'asking for a commitment anyway is the failure.'

const instructionsPriorityRule = ({ possessive }: SubjectNouns): string =>
  `If the ${possessive} own instructions are given below, follow them as long ` +
  'as they do not conflict with the rules above — never invent a date, ' +
  'place, or fact even if instructed to, and never assert anything about ' +
  'the audience even if instructed to.'

export interface DoorKnockingVoiceConfig<TPurpose extends string> {
  purposePrompts: Record<TPurpose, string>
  draftSystemPrompt: string
  improveSystemPrompt: string
  nameLabel: string
  officeLabel: string
  subjectFallback: string
  materialsLabel: string
  // The rail's nouns, so the audience block's rule reads in the same voice as
  // the system prompt that already states it.
  nouns: SubjectNouns
  // How the template's five sections are described back to the model, so it
  // knows the shape of the conversation its three lines sit inside without
  // writing the other two. The wording differs by rail because the composed
  // identity clause does ("running for" is a claim about a ballot an elected
  // official is not on).
  cardShape: string
}

// Steers, not text that ships. Each says what commitment the ask should aim
// at and what the engagement question should open with; the model writes the
// notes. That is the whole reason these can be prompt copy rather than the
// per-purpose constants this feature first reached for — and why a wrong
// steer shifts output rather than putting words in a canvasser's mouth,
// unlike the shipped per-purpose copy that robocall and phone banking had to
// correct in #1379 (see doorKnockingPurposes.ts and its Serve twin).
//
// Written here rather than waited on: engineering's read of what each goal
// asks for at a door, cheap to change once the eval set has been graded.
// Every one of them names a SINGLE commitment, per ASK_RULE above; the
// per-purpose job is to say which one.
const WIN_PURPOSE_PROMPTS: Record<DoorKnockingTalkingPointsPurpose, string> = {
  introduce_myself:
    'Purpose: a first introduction. The ask is whether the resident would ' +
    'like to hear from the campaign again — a yes-or-no about staying in ' +
    'touch, never a request for support from someone who just learned the ' +
    'name. The engagement question invites them to name what they care ' +
    'about locally.',
  persuade_voters:
    'Purpose: persuasion. The ask is for their vote, once and plainly — ' +
    'whether the candidate can count on them. The engagement question is ' +
    'open-ended and about what matters most to them, so the canvasser ' +
    'listens before connecting anything to it.',
  event_invite:
    'Purpose: an event invitation. The ask carries the logistics and asks ' +
    'the resident to come — this is the one line that may use [date], ' +
    '[time] and [location] brackets. The engagement question is a light ' +
    'opener about the neighborhood, not about the event.',
  early_voting:
    'Purpose: early voting. The ask is a commitment to vote early — better ' +
    'as a specific day than as "sometime during early voting", since a ' +
    'named day is the one a person keeps — and it names the window only if ' +
    'a real one is given below. The engagement question checks whether the ' +
    'resident already knows their early-voting options, phrased as a ' +
    'question and never as an assertion about dates.',
  election_day_turnout:
    'Purpose: election day turnout. The ask is a commitment to vote on ' +
    'election day, naming the date only if a real one is given below. The ' +
    'engagement question asks whether they have a plan for getting there — ' +
    'when in the day, or how — because a plan is what turns a yes into a ' +
    'vote.',
  // Never freshly generated — see the guard in generateDraft.
  custom:
    'Purpose: the candidate wrote these points themselves. Adapt what they ' +
    'wrote into the three bullet notes without adding claims of your own.',
}

const SERVE_PURPOSE_PROMPTS: Record<
  ServeDoorKnockingTalkingPointsPurpose,
  string
> = {
  introduce_myself:
    'Purpose: a first introduction from the office. The ask is whether the ' +
    'constituent would like to hear from the office again — a yes-or-no ' +
    'about staying in touch, never a request for support. The engagement ' +
    'question invites them to name what they care about locally.',
  explain_decision:
    'Purpose: explaining a recent decision. This is a listening purpose: ' +
    "the ask is one question inviting the constituent's reaction, never a " +
    'request for support for the decision. The engagement question asks ' +
    'whether they have heard about it — never assert what they know or ' +
    'think of it.',
  event_invite:
    'Purpose: an event invitation. The ask carries the logistics and asks ' +
    'the constituent to come — this is the one line that may use [date], ' +
    '[time] and [location] brackets. The engagement question is a light ' +
    'opener about the neighborhood, not about the event.',
  community_input:
    'Purpose: listening. There is no commitment to seek: the ask is one ' +
    'question about what the office should be working on, and the whole ' +
    'card reads as an invitation to talk rather than a pitch. The ' +
    'engagement question is the most open one on this list.',
  share_resource:
    'Purpose: sharing a service or program. The ask is whether they would ' +
    'like the details of it — a yes-or-no, and never a sign-up at the door ' +
    '— and it names only a program the materials below actually describe. ' +
    'The engagement question asks whether they have run into the need it ' +
    'addresses.',
  custom:
    'Purpose: the official wrote these points themselves. Adapt what they ' +
    'wrote into the three bullet notes without adding claims of their own.',
}

const WIN_CARD_SHAPE = [
  'The canvasser reads a five-section card. You are writing THREE of the',
  'five; the other two are composed by the app from campaign records and',
  'are not yours to write:',
  '  1. Introduction — the app writes "Hi, I\'m {name}, running for',
  '     {office}." or the volunteer equivalent. YOU write the short',
  '     engagement question that follows it.',
  '  2. Context — YOU write this: why this candidate, in one idea.',
  '  3. Call to action — the app writes this from the campaign record.',
  '  4. Ask — YOU write this: the one thing to ask of the resident.',
  '  5. Departure — the app writes a fixed thank-you.',
].join('\n')

const SERVE_CARD_SHAPE = [
  'The canvasser reads a five-section card. You are writing THREE of the',
  "five; the other two are composed by the app from the office's own",
  'records and are not yours to write:',
  '  1. Introduction — the app writes "Hi, I\'m {name}, your {office}." or',
  '     the volunteer equivalent. YOU write the short engagement question',
  '     that follows it.',
  '  2. Context — YOU write this: why this office is at the door, in one',
  '     idea.',
  "  3. Call to action — the app writes this from the office's record.",
  '  4. Ask — YOU write this: the one thing to ask of the constituent.',
  '  5. Departure — the app writes a fixed thank-you.',
].join('\n')

// Read after "You are ". Serve's omits the word "campaign" entirely, matching
// every other serve prompt in this module — the person already holds the
// office, and framing their constituent-service walk as campaign work is the
// win/serve leak these prompts exist to avoid.
const WIN_PERSONA =
  'a campaign writing assistant helping an independent, non-partisan local candidate'
const SERVE_PERSONA =
  'a writing assistant helping a local elected official who already holds this office'

const draftSystemPrompt = (
  persona: string,
  cardShape: string,
  nouns: SubjectNouns,
): string =>
  [
    `You are ${persona} prepare the`,
    'talking points a canvasser carries from door to door.',
    '',
    cardShape,
    '',
    'Rules:',
    `- ${NOTES_NOT_DIALOGUE_RULE}`,
    `- ${CONCRETE_HOW_RULE}`,
    `- ${inventionBanRule(nouns)}`,
    `- ${audienceUseRule(nouns)}`,
    `- ${ASK_RULE}`,
    '- The context line is EVERGREEN: no dates, no deadlines, no events.',
    '  A list is walked over weeks, and the ask is where a date belongs.',
    `- ${BRACKETS_RULE}`,
    `- ${noLinksRule(nouns)}`,
    `- ${LENGTH_RULE}`,
    `- ${instructionsPriorityRule(nouns)}`,
    '- Stay strictly non-partisan. No party labels, no attacks, no',
    '  opponents named.',
  ].join('\n')

const improveSystemPrompt = (
  persona: string,
  cardShape: string,
  nouns: SubjectNouns,
): string =>
  [
    `You are ${persona} polish the`,
    'door-knocking talking points they wrote themselves.',
    'This is a light edit, NOT a rewrite.',
    '',
    cardShape,
    '',
    'Rules:',
    '- Every concrete detail in the original MUST appear in your output:',
    '  places, events, names, numbers, and the ask. Dropping one is a',
    '  failure.',
    `- ${NOTES_NOT_DIALOGUE_RULE} If the original is written as dialogue,`,
    '  compress it into notes.',
    `- ${CONCRETE_HOW_RULE}`,
    '- Never add facts, positions, endorsements, statistics, dates, places,',
    `  or events the original does not contain — the ${nouns.materials},`,
    '  where provided, are context for accuracy, not a source of new',
    '  content in a polish.',
    `- ${audienceUseRule(nouns)}`,
    `- ${ASK_RULE} If the original stacks two, keep the one the`,
    '  purpose below names and drop the other.',
    `- ${BRACKETS_RULE} Strip any other bracket the original contains and`,
    '  write around the gap in plain language.',
    `- ${noLinksRule(nouns)} Remove any that appear in the original.`,
    `- ${LENGTH_RULE}`,
    `- ${instructionsPriorityRule(nouns)}`,
    '- Stay strictly non-partisan. No party labels, no attacks.',
  ].join('\n')

export const WIN_DOOR_KNOCKING_VOICE: DoorKnockingVoiceConfig<DoorKnockingTalkingPointsPurpose> =
  {
    purposePrompts: WIN_PURPOSE_PROMPTS,
    draftSystemPrompt: draftSystemPrompt(
      WIN_PERSONA,
      WIN_CARD_SHAPE,
      WIN_NOUNS,
    ),
    improveSystemPrompt: improveSystemPrompt(
      WIN_PERSONA,
      WIN_CARD_SHAPE,
      WIN_NOUNS,
    ),
    nameLabel: 'Candidate name',
    officeLabel: 'Office sought',
    subjectFallback: 'The candidate',
    materialsLabel: WIN_NOUNS.materials,
    nouns: WIN_NOUNS,
    cardShape: WIN_CARD_SHAPE,
  }

export const SERVE_DOOR_KNOCKING_VOICE: DoorKnockingVoiceConfig<ServeDoorKnockingTalkingPointsPurpose> =
  {
    purposePrompts: SERVE_PURPOSE_PROMPTS,
    draftSystemPrompt: draftSystemPrompt(
      SERVE_PERSONA,
      SERVE_CARD_SHAPE,
      SERVE_NOUNS,
    ),
    improveSystemPrompt: improveSystemPrompt(
      SERVE_PERSONA,
      SERVE_CARD_SHAPE,
      SERVE_NOUNS,
    ),
    nameLabel: 'Elected official name',
    officeLabel: 'Office held',
    subjectFallback: 'The elected official',
    materialsLabel: SERVE_NOUNS.materials,
    nouns: SERVE_NOUNS,
    cardShape: SERVE_CARD_SHAPE,
  }

export interface DoorKnockingDraftInput<TPurpose extends string> {
  purpose: TPurpose
  currentDraft?: string
  previousDraft?: string
  instructions?: string
}

// No .max() on the three lines, deliberately: an instructions-driven result
// can land a few characters over the budget, and a hard max would fail Zod ->
// be caught -> 502, turning a recoverable output into an unrecoverable error.
// Robocall hit exactly this. The trim below enforces the cap instead, and the
// response schema enforces it again at the wire.
const DraftSchema = z.object({
  engagementQuestion: z.string().min(1),
  context: z.string().min(1),
  ask: z.string().min(1),
})

// Each section must come back as ONE line, because the wizard stores the four
// card lines newline-separated on `Outreach.script`. A model that wraps a long
// context line, or emits its own "- " bullet marker, would otherwise split one
// section into two at the door. Collapsing whitespace here is what makes that
// encoding safe, rather than trusting the prompt's length rule to hold.
const asSingleLine = (line: string): string =>
  line
    .replace(/^[-•*\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()

// Safety net for a line that lands over budget. Cuts at the last sentence
// boundary rather than mid-word, falling back a step at a time. Exported for
// unit testing.
export const trimLineToSentenceBoundary = (
  line: string,
  maxLength: number,
): string => {
  if (line.length <= maxLength) return line

  const truncated = line.slice(0, maxLength)

  const lastStop = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('? '),
    truncated.lastIndexOf('! '),
  )
  if (lastStop > 0) return truncated.slice(0, lastStop + 1).trimEnd()

  const atWord = truncated.replace(/\s+\S*$/, '').trimEnd()
  if (atWord.length > 0) return atWord

  return truncated
}

// Delimited with a triple-quote fence so the model reads it as quoted
// candidate text rather than as further instructions to the prompt itself.
const fenced = (heading: string, body: string): string[] => [
  heading,
  '"""',
  body,
  '"""',
]

@Injectable()
export class OutreachDoorKnockingGenerationService {
  constructor(
    private readonly llm: LlmService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachDoorKnockingGenerationService.name)
  }

  // The audience block, restated beside the description it governs rather than
  // left to the system prompt alone — the constraint travels with the data.
  // Both come from `audienceUseRule`, so the two cannot drift.
  //
  // Absent entirely when the filter says nothing this feature may act on:
  // `describeFilterForTalkingPoints` returns null rather than "no filters
  // applied" for exactly that case, because telling the model a party-only
  // list is unfiltered is a lie it would then write around.
  private buildAudienceContext<TPurpose extends string>(
    description: string | null,
    voice: DoorKnockingVoiceConfig<TPurpose>,
  ): string[] {
    if (!description) return []
    return [
      `The audience this list selects: ${description}`,
      audienceUseRule(voice.nouns),
      FILTER_DIMENSION_PROVENANCE_RULES,
    ]
  }

  async generateDraft<TPurpose extends string>({
    input,
    name,
    office,
    userId,
    extraContext,
    audienceDescription,
    voice,
  }: {
    input: DoorKnockingDraftInput<TPurpose>
    name: string
    office: string
    userId: string
    extraContext: string[]
    // Null when the list's filters say nothing this feature may act on.
    audienceDescription: string | null
    voice: DoorKnockingVoiceConfig<TPurpose>
  }): Promise<DoorKnockingTalkingPointsDraftResponse> {
    // Fresh generation only: improve mode polishes the author's own words, so
    // it applies to custom-purpose points too.
    if (input.purpose === 'custom' && !input.currentDraft) {
      throw new BadRequestException(
        'Custom-purpose talking points are written by the user',
      )
    }

    const context = [
      `${voice.nameLabel}: ${name || voice.subjectFallback}.`,
      `${voice.officeLabel}: ${office || 'local office'}.`,
      voice.purposePrompts[input.purpose],
      ...extraContext,
      ...this.buildAudienceContext(audienceDescription, voice),
    ]

    const messages: LlmMessage[] = input.currentDraft
      ? [
          { role: 'system', content: voice.improveSystemPrompt },
          {
            role: 'user',
            content: [
              ...context,
              // Surface-neutral wording (never "candidate"/"official") so the
              // shared path does not leak Win framing onto Serve.
              ...fenced(
                'The existing talking points to polish:',
                input.currentDraft,
              ),
              'Polish the talking points.',
              ...this.instructionsBlock(input.instructions, voice),
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
                ? [
                    ...fenced(
                      `The talking points ${this.lowerFirst(voice.subjectFallback)} just rejected:`,
                      input.previousDraft,
                    ),
                    `${voice.subjectFallback} rejected these. Write ` +
                      'noticeably different notes: a different engagement ' +
                      'question, a different angle in the context line, and ' +
                      `different supporting details from the ${voice.materialsLabel}. ` +
                      'Do not reuse their distinctive phrases.',
                  ]
                : []),
              'Write the talking points.',
              ...this.instructionsBlock(input.instructions, voice),
            ].join('\n'),
          },
        ]

    try {
      const { object } = await this.llm.jsonCompletion({
        messages,
        schema: DraftSchema,
        // High enough that Regenerate re-rolls produce different notes.
        temperature: 0.8,
        maxTokens: 512,
        userId,
      })
      const line = (value: string): string =>
        trimLineToSentenceBoundary(
          asSingleLine(value),
          DOOR_KNOCKING_TALKING_POINT_MAX_LENGTH,
        )
      return {
        engagementQuestion: line(object.engagementQuestion),
        context: line(object.context),
        ask: line(object.ask),
      }
    } catch (err) {
      this.logger.error({ err }, 'Door knocking talking points failed')
      throw new BadGatewayException('Talking points generation failed')
    }
  }

  private lowerFirst(value: string): string {
    return value.charAt(0).toLowerCase() + value.slice(1)
  }

  private instructionsBlock<TPurpose extends string>(
    instructions: string | undefined,
    voice: DoorKnockingVoiceConfig<TPurpose>,
  ): string[] {
    if (!instructions) return []
    return fenced(
      `${voice.subjectFallback}'s own instructions for these talking ` +
        'points — follow them as long as they do not conflict with the ' +
        'rules above:',
      instructions,
    )
  }
}

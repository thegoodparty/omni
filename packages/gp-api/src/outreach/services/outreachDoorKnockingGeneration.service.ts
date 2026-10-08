import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import {
  DOOR_KNOCKING_BULLET,
  DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH,
  type DoorKnockingTalkingPointsDraftResponse,
  type OutreachEventDetails,
  type DoorKnockingTalkingPointsPurpose,
  type ServeDoorKnockingTalkingPointsPurpose,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import { FILTER_DIMENSION_PROVENANCE_RULES } from '@/contacts/filterDimensions.catalog'
import { eventDetailsContext } from '../util/eventDetails.util'

// Door-knocking talking points: the whole card a canvasser carries, from how
// to open to how to close. The walk shows exactly these lines.
//
// A fresh draft is 4 or 5 bullets, assembled here from a list the model
// returns, so every line starts with DOOR_KNOCKING_BULLET whatever the model
// did. An Improve polishes whatever the candidate wrote and keeps its shape:
// bullets stay bullets, sentences stay sentences.
//
// The card is read by the candidate and by volunteers alike, so the subject is
// named in the third person and never as the speaker: a first-person line is a
// volunteer claiming to be the candidate. See gp-api/docs/door-knocking.md.

// The rule stated first, because it is the one the other channels' prompts
// would get exactly backwards. Phone banking and SMS produce text a person
// reads out; this produces notes a person reads FROM.
const NOTES_NOT_DIALOGUE_RULE =
  'These are BULLET NOTES a canvasser glances at on a doorstep and then ' +
  'says in their own words, never lines to recite. Do not write dialogue. ' +
  'Write what the canvasser needs to REMEMBER, not what they should say ' +
  'verbatim.'

// The single highest-leverage sentence in this prompt, lifted from the SMS
// one. The bullet format makes it MORE load-bearing rather than less: a note
// that compresses to "Roads" has told the canvasser nothing and pushes them
// into improvising at a door, which is where false claims come from.
const CONCRETE_HOW_RULE =
  'Name the concrete HOW, not just the topic ("Fix our roads with a real ' +
  'maintenance plan, not patchwork", never just "Fix our roads"). A note ' +
  'that names only a subject is a failure: the canvasser cannot expand it ' +
  'without inventing something.'

// The model imitates its prompt, so the prompt strings themselves carry no
// em dashes either.
const STYLE_RULE =
  'Plain spoken English in sentence case. No em dashes, no emoji, no ' +
  'jargon.'

// Nouns that differ by rail. Every rule below that names the person is a
// function of these, because a serve prompt that says "candidate" or
// "campaign" has leaked win framing into constituent service, the same
// isolation the serve controller enforces on the data side.
interface SubjectNouns {
  // Possessive, without the article: "candidate's" / "official's".
  possessive: string
  // The prompt block those materials arrive in, so the rule names what the
  // model can actually see.
  materials: string
  // Whose goal the bullets carry: "the campaign" / "the office".
  effort: string
}

const WIN_NOUNS: SubjectNouns = {
  possessive: "candidate's",
  materials: 'campaign materials',
  effort: 'the campaign',
}

const SERVE_NOUNS: SubjectNouns = {
  possessive: "official's",
  materials: "official's own materials",
  effort: 'the office',
}

// The bullets are written once for the whole list and read at every door, so
// they are about what the effort is asking for. A bullet about the person at
// the door is a guess about a stranger.
const goalNotVoterRule = ({ effort }: SubjectNouns): string =>
  `Every bullet is about what ${effort} is working toward or asking for, ` +
  'never about the person who answers the door.'

// The card has no composed frame around it, so the model writes both ends,
// as notes like every other line.
const OPEN_AND_CLOSE_RULE =
  'The first bullet is how to open (for example "Open warm, thank them for ' +
  'the time.") and the last is how to close, which is where the ask goes. ' +
  'Write both as notes, never a scripted greeting or goodbye to recite.'

const thirdPersonRule = ({ possessive }: SubjectNouns): string =>
  `Refer to the ${possessive.replace("'s", '')} by first name, in the third ` +
  'person ("Say what Renee is already doing"), never as "I": a volunteer ' +
  'reads this card too.'

const inventionBanRule = ({ materials }: SubjectNouns): string =>
  `Ground every bullet in the ${materials} when they are ` +
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
  'the door, and nothing you write may assert, imply, or allude to it: no ' +
  '"as a homeowner", no "for families like yours", no "at your age". The ' +
  'canvasser does not know who is behind the door, and a resident told what ' +
  'a list says about them hears surveillance, not outreach.'

// An event invite's date, time and place arrive as event details from the
// flow, so nothing in the talking points is ever a blank to fill.
const BRACKETS_RULE =
  'Never write a bracketed placeholder. An event date, time or place ' +
  'comes only from the event details given below; without them, leave the ' +
  'logistics out, and never invent a specific date, time or place.'

const NO_LINKS_RULE =
  'Never write a URL, a web address, a phone number, or a QR code.'

const BULLETS_RULE =
  'Write 4 or 5 short bullets, in the order a conversation at the door ' +
  'would reach them. Each bullet is ONE action or idea, at most about 25 words, ' +
  'because it is read while a door is opening. Return each bullet as plain ' +
  'text, with no bullet marker, number or dash in front of it.'

// What every per-purpose steer below has in common, stated once rather than
// nine times. The shape of a door ask is not a per-purpose question: it is
// one thing, answerable where the resident is standing, and small enough
// that "yes" costs them nothing they have to think about. Two asks in one
// bullet is the common failure: "vote early and take a yard sign" gets a nod
// and neither.
const ASK_RULE =
  'Exactly one bullet is the ask: ONE request and no more, answerable ' +
  'where the resident is standing, with nothing to fetch, sign up for, or ' +
  'think over first. Never stack two requests into it. Where the purpose ' +
  'below seeks a commitment, the ask is a yes-or-no the canvasser can ' +
  'record, never softened into a statement. Where the purpose is ' +
  'listening, it is a single question, and asking for a commitment anyway ' +
  'is the failure.'

const instructionsPriorityRule = ({ possessive }: SubjectNouns): string =>
  `If the ${possessive} own instructions are given below, follow them as long ` +
  'as they do not conflict with the rules above: never invent a date, ' +
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
  // What the app says around the talking points, described back to the model
  // so it does not write either end. The wording differs by rail because the
  // composed introduction does ("running for" is a claim about a ballot an
  // elected official is not on).
  cardShape: string
}

// Steers, not text that ships. Each says what the bullets should cover and
// what commitment the ask should aim at; the model writes the notes. That is
// the whole reason these can be prompt copy rather than the per-purpose
// constants this feature first reached for, and why a wrong steer shifts
// output rather than putting words in a canvasser's mouth, unlike the shipped
// per-purpose copy that robocall and phone banking had to correct in #1379
// (see doorKnockingPurposes.ts and its Serve twin).
//
// Written here rather than waited on: engineering's read of what each goal
// asks for at a door, cheap to change once the eval set has been graded.
// Every one of them names a SINGLE commitment, per ASK_RULE above; the
// per-purpose job is to say which one.
const WIN_PURPOSE_PROMPTS: Record<DoorKnockingTalkingPointsPurpose, string> = {
  introduce_myself:
    'Purpose: a first introduction. The bullets cover what the candidate ' +
    'will work on. One bullet asks what the resident cares about locally. ' +
    'The ask is whether they would like to hear from the campaign again, a ' +
    'yes-or-no about staying in touch, never a request for support from ' +
    'someone who just learned the name.',
  persuade_voters:
    'Purpose: persuasion. One bullet asks an open-ended question about what ' +
    'matters most to them, so the canvasser listens before connecting ' +
    'anything to it. The ask is for their vote, once and plainly: whether ' +
    'the candidate can count on them.',
  event_invite:
    'Purpose: an event invitation. The bullets say what the event is for. ' +
    'The ask carries the date, time and place from the event details below, ' +
    'as given, and asks the resident to come.',
  early_voting:
    'Purpose: early voting. One bullet checks whether the resident already ' +
    'knows their early-voting options, phrased as a question and never as ' +
    'an assertion about dates. The ask is a commitment to vote early, ' +
    'better as a specific day than as "sometime during early voting", since ' +
    'a named day is the one a person keeps, and it names the window only if ' +
    'a real one is given below.',
  election_day_turnout:
    'Purpose: election day turnout. One bullet asks whether they have a ' +
    'plan for getting there, when in the day or how, because a plan is what ' +
    'turns a yes into a vote. The ask is a commitment to vote on election ' +
    'day, naming the date only if a real one is given below.',
  community_input:
    'Purpose: listening. There is no commitment to seek: the ask is one ' +
    'question about what the candidate should be working on, and every ' +
    'bullet reads as an invitation to talk rather than a pitch.',
  // Never freshly generated: see the guard in generateDraft.
  custom:
    'Purpose: the candidate wrote these points themselves. Polish what they ' +
    'wrote without adding claims of your own.',
}

const SERVE_PURPOSE_PROMPTS: Record<
  ServeDoorKnockingTalkingPointsPurpose,
  string
> = {
  introduce_myself:
    'Purpose: a first introduction from the office. The bullets cover what ' +
    'the office is working on. One bullet asks what the constituent cares ' +
    'about locally. The ask is whether they would like to hear from the ' +
    'office again, a yes-or-no about staying in touch, never a request for ' +
    'support.',
  explain_decision:
    'Purpose: explaining a recent decision. The bullets say what was ' +
    'decided and why, as the materials below give it. One bullet asks ' +
    'whether they have heard about it; never assert what they know or think ' +
    'of it. This is a listening purpose: the ask is one question inviting ' +
    "the constituent's reaction, never a request for support for the " +
    'decision.',
  event_invite:
    'Purpose: an event invitation. The bullets say what the event is for. ' +
    'The ask carries the date, time and place from the event details below, ' +
    'as given, and asks the constituent to come.',
  community_input:
    'Purpose: listening. There is no commitment to seek: the ask is one ' +
    'question about what the office should be working on, and every bullet ' +
    'reads as an invitation to talk rather than a pitch.',
  share_resource:
    'Purpose: sharing a service or program. One bullet asks whether they ' +
    'have run into the need it addresses. The ask is whether they would ' +
    'like the details of it, a yes-or-no and never a sign-up at the door, ' +
    'and it names only a program the materials below actually describe.',
  custom:
    'Purpose: the official wrote these points themselves. Polish what they ' +
    'wrote without adding claims of their own.',
}

const WIN_CARD_SHAPE = [
  'The talking points are the whole card a volunteer canvasser works from at',
  'each door, from the opening to the close. Nothing is added around them.',
].join('\n')

const SERVE_CARD_SHAPE = [
  'The talking points are the whole card a volunteer canvasser works from at',
  'each door, from the opening to the close,',
  'for a conversation with a constituent. Nothing is added around them.',
].join('\n')

// Read after "You are ". Serve's omits the word "campaign" entirely, matching
// every other serve prompt in this module: the person already holds the
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
    `- ${BULLETS_RULE}`,
    `- ${OPEN_AND_CLOSE_RULE}`,
    `- ${goalNotVoterRule(nouns)}`,
    `- ${thirdPersonRule(nouns)}`,
    `- ${CONCRETE_HOW_RULE}`,
    `- ${inventionBanRule(nouns)}`,
    `- ${audienceUseRule(nouns)}`,
    `- ${ASK_RULE}`,
    '- Every bullet but the ask is EVERGREEN: no dates, no deadlines, no',
    '  events. A list is walked over weeks, and the ask is where a date',
    '  belongs.',
    `- ${BRACKETS_RULE}`,
    `- ${NO_LINKS_RULE}`,
    `- ${STYLE_RULE}`,
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
    '- Keep the shape they wrote. If they wrote bullet points, return bullet',
    '  points; if they wrote sentences, return sentences. Never turn one into',
    '  the other. Keep their line breaks, and keep any marker a line starts',
    '  with (such as "•") exactly as written.',
    '- Every concrete detail in the original MUST appear in your output:',
    '  places, events, names, numbers, and the ask. Dropping one is a',
    '  failure.',
    '- Never add facts, positions, endorsements, statistics, dates, places,',
    `  or events the original does not contain. The ${nouns.materials},`,
    '  where provided, are context for accuracy, not a source of new',
    '  content in a polish.',
    '- Keep it about as long as the original.',
    `- ${audienceUseRule(nouns)}`,
    `- ${BRACKETS_RULE} Strip any bracket the original contains and`,
    '  write around the gap in plain language.',
    `- ${NO_LINKS_RULE} Remove any that appear in the original.`,
    `- ${STYLE_RULE}`,
    `- ${instructionsPriorityRule(nouns)}`,
    '- Stay strictly non-partisan. No party labels, no attacks.',
    '- Return the polished text as one string.',
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
  // The community-input purpose only, on either product. Absent everywhere
  // else, which is why the block it produces is conditional rather than a
  // fixed line.
  communityInputQuestion?: string
  event?: OutreachEventDetails
}

// One bullet's budget: about 25 words with room to spare, so a phone screen
// holds the whole list.
const BULLET_MAX_LENGTH = 200

// No .max() on the strings, deliberately: an instructions-driven result can
// land a few characters over the budget, and a hard max would fail Zod ->
// be caught -> 502, turning a recoverable output into an unrecoverable error.
// Robocall hit exactly this. The trims below enforce the caps instead, and
// the response schema enforces the total again at the wire.
// The prompt asks for 4 or 5. A reply with a few more or fewer is still a
// usable draft the candidate edits, so it is kept (capped at MAX_BULLETS)
// rather than failed as a 502, for the same reason as the note above.
const MAX_BULLETS = 5
const BulletsSchema = z.object({
  points: z.array(z.string()).min(1),
})

const ImproveSchema = z.object({
  draft: z.string().min(1),
})

// Each bullet must come back as ONE line, because the draft is the bullets
// newline-separated. A model that wraps a long bullet, or adds its own marker,
// would otherwise split one bullet into two or print "• - Fix" at the door.
const asBulletText = (point: string): string =>
  point
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[-•*]\s*|\d+[.)]\s+)+/, '')
    .trim()

// Deploy compatibility, to delete once a release has settled: a webapp tab
// from before free text still reads the three sections it used to edit. The
// current webapp reads only `draft`.
const legacySections = (
  draft: string,
): Omit<DoorKnockingTalkingPointsDraftResponse, 'draft'> => {
  const marker = DOOR_KNOCKING_BULLET.trim()
  const lines = draft
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      return trimmed.startsWith(marker)
        ? trimmed.slice(marker.length).trim()
        : trimmed
    })
    .filter((line) => line.length > 0)
  return {
    engagementQuestion: lines[0] ?? '',
    context: lines.slice(1, -1).join(' '),
    ask: lines.length > 1 ? lines[lines.length - 1] : '',
  }
}

// Safety net for text that lands over budget. Cuts at the last sentence or
// line boundary rather than mid-word, falling back a step at a time. Exported
// for unit testing.
export const trimLineToSentenceBoundary = (
  line: string,
  maxLength: number,
): string => {
  if (line.length <= maxLength) return line

  const truncated = line.slice(0, maxLength)

  const sentenceEnd =
    Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('? '),
      truncated.lastIndexOf('! '),
    ) + 1
  const lineEnd = truncated.lastIndexOf('\n')
  const boundary = Math.max(sentenceEnd, lineEnd)
  if (boundary > 0) return truncated.slice(0, boundary).trimEnd()

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

  // The question this effort exists to ask, when there is one.
  //
  // Fenced for the reason every other piece of user text here is: it is
  // typed by a person and must read as quoted material, not as further
  // instructions to the prompt. The ask is the bullet it governs: the whole
  // point of the community-input purpose is that the conversation closes on
  // this question rather than on a generic one, so the rule sits beside it.
  private buildQuestionContext(question?: string): string[] {
    if (!question) return []
    return [
      ...fenced('The question this effort is trying to answer:', question),
      // "In place of" is load-bearing: the listening purpose above tells the
      // model the ask is one general question about what the office or the
      // candidate should work on, which is the ask this field exists to
      // replace. Without a stated precedence the two instructions simply
      // conflict.
      'One bullet must put this question to the resident, in place of the ' +
        'general question described above. Keep what it asks exactly. You ' +
        'may word it to invite them to say more, but do not widen it into a ' +
        'general what-matters-to-you question and do not answer it yourself.',
    ]
  }

  // The audience block, restated beside the description it governs rather than
  // left to the system prompt alone: the constraint travels with the data.
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
      ...this.buildQuestionContext(input.communityInputQuestion),
      ...extraContext,
      ...this.buildAudienceContext(audienceDescription, voice),
    ]

    try {
      const draft = input.currentDraft
        ? await this.improve(context, input, voice, userId)
        : await this.writeBullets(context, input, voice, userId)
      return { draft, ...legacySections(draft) }
    } catch (err) {
      this.logger.error({ err }, 'Door knocking talking points failed')
      throw new BadGatewayException('Talking points generation failed')
    }
  }

  private async writeBullets<TPurpose extends string>(
    context: string[],
    input: DoorKnockingDraftInput<TPurpose>,
    voice: DoorKnockingVoiceConfig<TPurpose>,
    userId: string,
  ): Promise<string> {
    const messages: LlmMessage[] = [
      { role: 'system', content: voice.draftSystemPrompt },
      {
        role: 'user',
        content: [
          ...context,
          ...eventDetailsContext(input.purpose, input.event),
          ...(input.previousDraft
            ? [
                ...fenced(
                  `The talking points ${this.lowerFirst(voice.subjectFallback)} just rejected:`,
                  input.previousDraft,
                ),
                `${voice.subjectFallback} rejected these. Write ` +
                  'noticeably different notes: a different angle and ' +
                  `different supporting details from the ${voice.materialsLabel}. ` +
                  'Do not reuse their distinctive phrases.',
              ]
            : []),
          'Write the talking points.',
          ...this.instructionsBlock(input.instructions, voice),
        ].join('\n'),
      },
    ]

    const { object } = await this.llm.jsonCompletion({
      messages,
      schema: BulletsSchema,
      // High enough that Regenerate re-rolls produce different notes.
      temperature: 0.8,
      maxTokens: 512,
      userId,
    })
    const bullets = object.points
      .map((point) =>
        trimLineToSentenceBoundary(asBulletText(point), BULLET_MAX_LENGTH),
      )
      .filter((point) => point.length > 0)
      .slice(0, MAX_BULLETS)
    if (bullets.length === 0) {
      throw new Error('Talking points came back empty')
    }
    return bullets.map((point) => `${DOOR_KNOCKING_BULLET}${point}`).join('\n')
  }

  private async improve<TPurpose extends string>(
    context: string[],
    input: DoorKnockingDraftInput<TPurpose>,
    voice: DoorKnockingVoiceConfig<TPurpose>,
    userId: string,
  ): Promise<string> {
    const messages: LlmMessage[] = [
      { role: 'system', content: voice.improveSystemPrompt },
      {
        role: 'user',
        content: [
          ...context,
          // Surface-neutral wording (never "candidate"/"official") so the
          // shared path does not leak Win framing onto Serve.
          ...fenced(
            'The existing talking points to polish:',
            input.currentDraft ?? '',
          ),
          'Polish the talking points.',
          ...this.instructionsBlock(input.instructions, voice),
        ].join('\n'),
      },
    ]

    const { object } = await this.llm.jsonCompletion({
      messages,
      schema: ImproveSchema,
      temperature: 0.8,
      // The whole field can be DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH
      // characters, which 512 tokens would cut short.
      maxTokens: 1024,
      userId,
    })
    const draft = trimLineToSentenceBoundary(
      object.draft.replace(/\r\n?/g, '\n').trim(),
      DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH,
    )
    if (draft.length === 0) {
      throw new Error('Polished talking points came back empty')
    }
    return draft
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
        'points. Follow them as long as they do not conflict with the ' +
        'rules above:',
      instructions,
    )
  }
}

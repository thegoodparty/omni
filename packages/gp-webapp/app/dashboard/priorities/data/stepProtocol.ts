import { z } from 'zod'
import type { LiveSegment } from '../../shared/agent-chat/streaming'

/**
 * The interaction contract between a step and the agent.
 *
 * The ordinance flow gets this from tools: `ask_clarify_question` renders a
 * widget, `save_synthesis` settles the step, `offer_next_step` renders the
 * Continue button. This flow has no scope of its own yet, so it asks a general
 * agent to end each turn with a fenced block and reads that instead. Same
 * three moves, parsed rather than called.
 *
 * The fence tag is `priority` so it can never be confused with a code block
 * the agent legitimately writes, and so a partially streamed block is easy to
 * hide until it closes.
 */

export const DIRECTIVE_FENCE = 'priority'

const QuestionDirectiveSchema = z.object({
  ask: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(6),
  // Why each option, in the agent's words. Optional and positional: index i
  // belongs to option i.
  notes: z.array(z.string()).optional(),
})

export const OUTREACH_CHANNELS = ['phone_banking', 'social'] as const

const OutreachPlanSchema = z.object({
  // The group in plain language, as the agent described it from the contact
  // data it actually queried.
  who: z.string().min(1),
  // How many of them there are, if the agent counted.
  count: z.number().int().nonnegative().optional(),
  channel: z.enum(OUTREACH_CHANNELS),
  // Why this group and this channel, in one line.
  why: z.string().min(1),
  // The thing to actually say to them, ready to review.
  message: z.string().min(1),
  // The saved list the agent built before proposing, so the offer is a
  // finished piece of work rather than a suggestion to go and do one.
  listId: z.number().int().positive().optional(),
  listName: z.string().optional(),
  // What to call the outreach itself, so the next screen opens named.
  campaignName: z.string().max(80).optional(),
})

// A local organization worth approaching, and why. The other half of hearing
// from people: a coalition reaches the people a contact file never will, and
// the official often has a relationship to trade on.
const OutreachOrgSchema = z.object({
  name: z.string().min(1),
  why: z.string().min(1),
  // Who to ask for when you get through.
  askFor: z.string().min(1),
  // What to actually say, ready to send or read out.
  script: z.string().min(1),
  email: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  url: z.string().max(500).optional(),
})

// Three separate beats, three separate turns. One card carrying the summary,
// the audience, the message and three organizations was more than anyone reads
// at once, and it collapsed decisions that happen at different moments: agree
// this is right, then send it, then work the coalitions.
const SynthesisDirectiveSchema = z.object({
  settled: z.string().min(1),
})

const OutreachDirectiveSchema = z.object({
  outreach: OutreachPlanSchema,
})

const OrgsDirectiveSchema = z.object({
  orgs: z.array(OutreachOrgSchema).min(1).max(5),
})

// A step that cannot be settled in the app, because what it needs happens at a
// council meeting, in an attorney's inbox, or in the two weeks it takes
// outreach to come back. Recording it is what lets the flow pick the thread up
// later instead of asking the same question again.
const WaitingDirectiveSchema = z.object({
  waiting: z.object({
    on: z.string().min(1),
    // What unblocks the step when it arrives.
    unblocks: z.string().min(1),
    // Roughly when, in the user's words ("after the March 11 meeting").
    when: z.string().optional(),
  }),
})

const DirectiveSchema = z.union([
  QuestionDirectiveSchema,
  WaitingDirectiveSchema,
  OutreachDirectiveSchema,
  OrgsDirectiveSchema,
  SynthesisDirectiveSchema,
])

export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number]

export type OutreachPlan = {
  who: string
  count: number | null
  channel: OutreachChannel
  why: string
  message: string
  listId: number | null
  listName: string | null
  campaignName: string | null
}

export type OutreachOrg = {
  name: string
  why: string
  askFor: string
  script: string
  email: string | null
  phone: string | null
  url: string | null
}

export type WaitingOn = {
  on: string
  unblocks: string
  when: string | null
}

export type PriorityDirective =
  | { kind: 'question'; ask: string; options: string[]; notes: string[] }
  | { kind: 'waiting'; waiting: WaitingOn }
  | { kind: 'synthesis'; settled: string }
  | { kind: 'outreach'; outreach: OutreachPlan }
  | { kind: 'orgs'; orgs: OutreachOrg[] }

const FENCE_OPEN = '```' + DIRECTIVE_FENCE

const toDirective = (raw: string): PriorityDirective | null => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = DirectiveSchema.safeParse(value)
  if (!parsed.success) return null
  if ('waiting' in parsed.data) {
    const { on, unblocks, when } = parsed.data.waiting
    return { kind: 'waiting', waiting: { on, unblocks, when: when ?? null } }
  }
  if ('settled' in parsed.data) {
    return { kind: 'synthesis', settled: parsed.data.settled }
  }
  if ('outreach' in parsed.data) {
    const plan = parsed.data.outreach
    return {
      kind: 'outreach',
      outreach: {
        ...plan,
        count: plan.count ?? null,
        listId: plan.listId ?? null,
        listName: plan.listName ?? null,
        campaignName: plan.campaignName ?? null,
      },
    }
  }
  if ('orgs' in parsed.data) {
    return {
      kind: 'orgs',
      orgs: parsed.data.orgs.map((org) => ({
        ...org,
        email: org.email ?? null,
        phone: org.phone ?? null,
        url: org.url ?? null,
      })),
    }
  }
  return {
    kind: 'question',
    ask: parsed.data.ask,
    options: parsed.data.options,
    notes: parsed.data.notes ?? [],
  }
}

/**
 * Split a turn's text into the prose to render and the directive that ends it.
 *
 * A block that has opened but not closed is a directive mid-stream: its text
 * is withheld (so half a JSON object never flashes on screen) and the
 * directive is null until it closes.
 */
export const parseTurnText = (
  text: string,
): {
  prose: string
  directive: PriorityDirective | null
  // A block that arrived complete and did not match any directive. The turn's
  // prose is usually written as though the card rendered ("the three groups
  // below"), so this cannot be swallowed: the caller asks for it again.
  malformed: boolean
} => {
  const open = text.indexOf(FENCE_OPEN)
  if (open === -1) return { prose: text, directive: null, malformed: false }

  const prose = text.slice(0, open).trimEnd()
  const afterOpen = text.slice(open + FENCE_OPEN.length)
  const close = afterOpen.indexOf('```')
  // Still streaming: not malformed, just unfinished.
  if (close === -1) return { prose, directive: null, malformed: false }

  const directive = toDirective(afterOpen.slice(0, close))
  return { prose, directive, malformed: directive === null }
}

/**
 * The same split across a turn's segments, so tool pills keep rendering in
 * stream order while the directive is held back. Text after the fence opens is
 * dropped; everything before it is left byte-identical.
 */
export const splitSegments = (
  segments: LiveSegment[],
): {
  segments: LiveSegment[]
  directive: PriorityDirective | null
  malformed: boolean
} => {
  const fullText = segments
    .map((s) => (s.kind === 'text' ? s.text : ''))
    .join('')
  const { directive, malformed } = parseTurnText(fullText)
  const open = fullText.indexOf(FENCE_OPEN)
  if (open === -1) return { segments, directive, malformed }

  const kept: LiveSegment[] = []
  let consumed = 0
  for (const segment of segments) {
    if (segment.kind !== 'text') {
      kept.push(segment)
      continue
    }
    const start = consumed
    consumed += segment.text.length
    if (start >= open) continue
    kept.push(
      consumed <= open
        ? segment
        : { ...segment, text: segment.text.slice(0, open - start).trimEnd() },
    )
  }
  return { segments: kept, directive, malformed }
}

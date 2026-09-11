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
  options: z.array(z.string().min(1)).min(2).max(4),
  // Why each option, in the agent's words. Optional and positional: index i
  // belongs to option i.
  notes: z.array(z.string()).optional(),
})

const SynthesisDirectiveSchema = z.object({
  settled: z.string().min(1),
  // How to check what was just settled against the people it lands on. The
  // agent proposes it; the user decides whether to run it.
  verify: z
    .object({
      who: z.string().min(1),
      ask: z.string().min(1),
    })
    .optional(),
})

const DirectiveSchema = z.union([
  QuestionDirectiveSchema,
  SynthesisDirectiveSchema,
])

export type VerifyPlan = { who: string; ask: string }

export type PriorityDirective =
  | { kind: 'question'; ask: string; options: string[]; notes: string[] }
  | { kind: 'synthesis'; settled: string; verify: VerifyPlan | null }

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
  return 'settled' in parsed.data
    ? {
        kind: 'synthesis',
        settled: parsed.data.settled,
        verify: parsed.data.verify ?? null,
      }
    : {
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
): { prose: string; directive: PriorityDirective | null } => {
  const open = text.indexOf(FENCE_OPEN)
  if (open === -1) return { prose: text, directive: null }

  const prose = text.slice(0, open).trimEnd()
  const afterOpen = text.slice(open + FENCE_OPEN.length)
  const close = afterOpen.indexOf('```')
  if (close === -1) return { prose, directive: null }

  return { prose, directive: toDirective(afterOpen.slice(0, close)) }
}

/**
 * The same split across a turn's segments, so tool pills keep rendering in
 * stream order while the directive is held back. Text after the fence opens is
 * dropped; everything before it is left byte-identical.
 */
export const splitSegments = (
  segments: LiveSegment[],
): { segments: LiveSegment[]; directive: PriorityDirective | null } => {
  const fullText = segments
    .map((s) => (s.kind === 'text' ? s.text : ''))
    .join('')
  const { directive } = parseTurnText(fullText)
  const open = fullText.indexOf(FENCE_OPEN)
  if (open === -1) return { segments, directive }

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
  return { segments: kept, directive }
}

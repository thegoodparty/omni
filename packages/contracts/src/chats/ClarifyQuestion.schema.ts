import { z } from 'zod'

/**
 * A structured question an agent asks inside a chat, answered from the UI.
 *
 * Deliberately scope-agnostic. The ordinance flow asks one and the priority
 * flow asks one, so anything added here is available to both. The tool that
 * carries it does no work server-side: the persisted tool args ARE the
 * question, and they are what the widget replays from on reload.
 */

/**
 * A cited source. Shared across the clarify options and the ordinance step
 * artifacts. Candidate for a normalized Source registry later (TDD Q12); JSON
 * for now.
 */
export const ChatSourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url().optional(),
  publisher: z.string().optional(),
  kind: z.enum(['external', 'internal']).optional(),
  excerpt: z.string().optional(),
  /** When the page was published or last updated, as it shows it ("March 2026"). */
  date: z.string().optional(),
})
export type ChatSource = z.infer<typeof ChatSourceSchema>

/**
 * One suggested answer to a clarify question. A factual option cites a source;
 * a pure-judgment option may omit one. The UI always adds an "Or write your
 * own..." freeform option on top of these, which is how the user bails back to
 * ordinary chat, so an agent never supplies one itself.
 */
export const ChatClarifyOptionSchema = z.object({
  label: z.string(),
  rationale: z.string().optional(),
  source: ChatSourceSchema.optional(),
})
export type ChatClarifyOption = z.infer<typeof ChatClarifyOptionSchema>

/**
 * One question, shown as a widget in the transcript. `multiSelect` turns the
 * options into checkboxes for a question where more than one answer can be
 * true. It defaults to false so questions persisted before it existed still
 * parse as single choice.
 */
export const ChatClarifyQuestionSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  options: z.array(ChatClarifyOptionSchema),
  multiSelect: z.boolean().default(false),
})
export type ChatClarifyQuestion = z.infer<typeof ChatClarifyQuestionSchema>

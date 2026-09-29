import {
  ChatClarifyQuestionSchema,
  type ChatClarifyQuestion,
} from '@goodparty_org/contracts'

// The tool whose call IS the question. It does no work server-side, so the
// persisted args carry the whole question and the widget replays from them.
export const CLARIFY_TOOL = 'ask_clarify_question'

// Args that don't parse drop the widget and leave the turn's prose alone, the
// same policy the cards use.
export const parseClarifyQuestion = (
  args: unknown,
): ChatClarifyQuestion | null => {
  const parsed = ChatClarifyQuestionSchema.safeParse(args)
  return parsed.success ? parsed.data : null
}

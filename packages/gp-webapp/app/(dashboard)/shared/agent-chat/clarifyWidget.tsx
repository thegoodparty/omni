import {
  ChatClarifyQuestionSchema,
  type ChatClarifyQuestion,
} from '@goodparty_org/contracts'
import ClarifyQuestionWidget from './ClarifyQuestionWidget'
import { defineWidgetTool } from './widgetRegistry'

// The tool whose call IS the question. It does no work server-side, so the
// persisted args carry the whole question and the widget replays from them.
export const CLARIFY_TOOL = 'ask_clarify_question'

export const parseClarifyQuestion = (
  args: unknown,
): ChatClarifyQuestion | null => {
  const parsed = ChatClarifyQuestionSchema.safeParse(args)
  return parsed.success ? parsed.data : null
}

export type ClarifyWidgetContext = {
  // Only the question still waiting on an answer takes input. An earlier one
  // reads back with its options locked, above the turn that answered it.
  clarifyInteractive: boolean
  // What the user said next. The widget highlights it when it matches an
  // option and shows it as written when it does not.
  clarifyAnswer?: string
  onClarifyAnswer: (answer: string) => void
}

export const clarifyWidgetTool = defineWidgetTool({
  toolName: CLARIFY_TOOL,
  parse: parseClarifyQuestion,
  render: (
    question,
    {
      clarifyInteractive,
      clarifyAnswer,
      onClarifyAnswer,
    }: ClarifyWidgetContext,
  ) => (
    <ClarifyQuestionWidget
      question={question}
      disabled={!clarifyInteractive}
      answer={clarifyAnswer}
      onAnswer={onClarifyAnswer}
    />
  ),
})

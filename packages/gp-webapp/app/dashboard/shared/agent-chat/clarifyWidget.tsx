import {
  ChatClarifyQuestionSchema,
  type ChatClarifyQuestion,
} from '@goodparty_org/contracts'
import ClarifyQuestionWidget from './ClarifyQuestionWidget'
import { defineWidgetTool } from './widgetRegistry'

// The tool whose call IS the question. It does no work server-side, so the
// persisted args carry the whole question and the widget replays from them.
export const CLARIFY_TOOL = 'ask_clarify_question'
// The Chief of Staff's weekly time question for the civic panel. Its words
// are fixed, so the app draws it (chief-of-staff civicPanelWidgets) instead of
// the model writing them, but it waits on an answer like any clarify question.
export const PANEL_WEEKLY_TIME_TOOL = 'ask_panel_weekly_time'

export const isQuestionTool = (toolName: string | null | undefined): boolean =>
  toolName === CLARIFY_TOOL || toolName === PANEL_WEEKLY_TIME_TOOL

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
  // option. A written-in answer is not echoed: these surfaces already show
  // it as the user's own message right below.
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
      showWrittenAnswer={false}
    />
  ),
})

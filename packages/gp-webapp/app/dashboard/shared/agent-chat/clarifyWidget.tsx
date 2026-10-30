import {
  ChatClarifyQuestionSchema,
  type ChatClarifyQuestion,
} from '@goodparty_org/contracts'
import ClarifyQuestionWidget from './ClarifyQuestionWidget'
import { defineWidgetTool } from './widgetRegistry'

// The tool whose call IS the question. It does no work server-side, so the
// persisted args carry the whole question and the widget replays from them.
export const CLARIFY_TOOL = 'ask_clarify_question'
// The Chief of Staff's offer to show the managed civic panel's invite: fixed
// words the app draws (chief-of-staff managedPanelWidgets), answered like a
// clarify question.
export const MANAGED_PANEL_OFFER_TOOL = 'offer_managed_panel_invite'
// The short groups of an exhausted civic panel, offered at the door or on a
// call (chief-of-staff managedPanelWidgets), answered like a clarify
// question.
export const REACH_THE_REST_OFFER_TOOL = 'offer_reach_the_rest'

export const isQuestionTool = (toolName: string | null | undefined): boolean =>
  toolName === CLARIFY_TOOL ||
  toolName === MANAGED_PANEL_OFFER_TOOL ||
  toolName === REACH_THE_REST_OFFER_TOOL

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
  // option. A written-in answer is echoed only where the surface hides the
  // answer's own user turn (the ordinance flow); elsewhere it already shows as
  // the user's own message right below.
  clarifyAnswer?: string
  clarifyShowsWrittenAnswer?: boolean
  onClarifyAnswer: (answer: string, question: ChatClarifyQuestion) => void
}

export const clarifyWidgetTool = defineWidgetTool({
  toolName: CLARIFY_TOOL,
  parse: parseClarifyQuestion,
  render: (
    question,
    {
      clarifyInteractive,
      clarifyAnswer,
      clarifyShowsWrittenAnswer = false,
      onClarifyAnswer,
    }: ClarifyWidgetContext,
  ) => (
    <ClarifyQuestionWidget
      question={question}
      disabled={!clarifyInteractive}
      answer={clarifyAnswer}
      onAnswer={(answer) => onClarifyAnswer(answer, question)}
      showWrittenAnswer={clarifyShowsWrittenAnswer}
    />
  ),
})

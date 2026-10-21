import { ChatClarifyQuestionSchema } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'

// How to ask, said once for every scope that registers the tool, so a card
// on one assistant never behaves differently from the same card on another.
export const CLARIFY_QUESTION_RULES = [
  '- Set `multiSelect` on `ask_clarify_question` when more than one answer can be true, such as options they could pursue together or symptoms of one problem. Leave it off when the answers rule each other out.',
  '- When the user has to pick between real options, ask with `ask_clarify_question`, one question at a time, never as a list in prose. Put the question and options only in the call.',
  '- Never end a message with an either/or or a pick-one question in prose. A "Yes" back tells you nothing. When the user has to choose, call `ask_clarify_question`.',
  '- The app shows the question above its options, so never write it, or any rewording of it, as chat text. Anything before the call is context that never ends in a question. If no context is needed, write nothing and just call the tool.',
]

// A no-op presenter: the call itself is the question. Its args persist as the
// tool segment the webapp widget renders and replays from, and the answer
// comes back as an ordinary user turn.
export const buildAskClarifyQuestionTool = (): LlmStreamTool<
  typeof ChatClarifyQuestionSchema
> => ({
  description:
    'Ask the user ONE clarifying question at a time. Provide 2-4 suggested ' +
    'options; a factual option should cite a source, a pure-judgment option ' +
    'need not. The UI always adds an "Or write your own..." freeform option, ' +
    'so never add one yourself. Do not ask the next question until this one is ' +
    'answered. Set multiSelect when more than one answer can be true, such as ' +
    'options the user could pursue together or symptoms of one problem; the ' +
    'options become checkboxes and the answer comes back as the chosen labels ' +
    'joined into one line. Leave it off when the answers rule each other out. ' +
    'The UI shows the question above its options, so never write ' +
    'the question, or any rewording of it, as chat text. Any text before ' +
    'this call is context and never ends in a question. Use this tool ' +
    'whenever the user has to choose; never end a message with an either/or ' +
    'or pick-one question in prose.',
  inputSchema: ChatClarifyQuestionSchema,
  execute: ({ questionId, options, multiSelect }) => {
    // A multi-select answer comes back as labels joined into one line, so a
    // label that contains another would read two ways on reload.
    const labels = options.map((option) => option.label.trim().toLowerCase())
    if (labels.some((label) => label === '')) {
      return {
        error:
          'Every option needs a label. Give each one a few words, then ask ' +
          'again.',
      }
    }
    const overlaps =
      multiSelect &&
      labels.some((label, i) =>
        labels.some((other, j) => i !== j && label.includes(other)),
      )
    return overlaps
      ? {
          error:
            'In a multiSelect question no option label can contain another. ' +
            'Reword the options so each stands alone, then ask again.',
        }
      : { asked: true, questionId }
  },
})

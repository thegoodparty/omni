import { ChatClarifyQuestionSchema } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'

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
    'joined into one line. Leave it off when the answers rule each other out.',
  inputSchema: ChatClarifyQuestionSchema,
  execute: ({ questionId }) => ({ asked: true, questionId }),
})

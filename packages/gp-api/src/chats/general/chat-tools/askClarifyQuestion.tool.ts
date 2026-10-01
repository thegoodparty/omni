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
    'answered. The UI shows the question above its options, so never write ' +
    'the question, or any rewording of it, as chat text. Any text before ' +
    'this call is context and never ends in a question. Use this tool ' +
    'whenever the user has to choose; never end a message with an either/or ' +
    'or pick-one question in prose.',
  inputSchema: ChatClarifyQuestionSchema,
  execute: ({ questionId }) => ({ asked: true, questionId }),
})

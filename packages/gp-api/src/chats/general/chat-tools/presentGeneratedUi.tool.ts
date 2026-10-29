import {
  checkGeneratedUiSpec,
  GeneratedUiSpecSchema,
} from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'

// A no-op presenter like the cards: the args are the json-render spec the
// webapp renders and replays. A spec that would not render comes back as an
// error the model can read and fix.
export const buildPresentGeneratedUiTool = (): LlmStreamTool<
  typeof GeneratedUiSpecSchema
> => ({
  description:
    'Show the user a small piece of interface built from the generated UI ' +
    'components: a dashboard of numbers, a comparison table, a person, a ' +
    'map of places, a proposed outreach, a question with options, or a ' +
    'button for the next step. The input is a json-render spec as described ' +
    'in the system prompt. Call it once per thing to show.',
  inputSchema: GeneratedUiSpecSchema,
  execute: (spec) => {
    const issues = checkGeneratedUiSpec(spec)
    return issues.length > 0
      ? {
          error: `The spec would not render. Fix these and call again:\n${issues.join('\n')}`,
        }
      : { shown: true }
  },
})

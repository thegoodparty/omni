import { ComposeHandoffPayloadSchema } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'

// Anthropic requires a tool's input_schema to be a top-level object. The
// contract's discriminated union converts to a top-level anyOf, which the API
// rejects — killing every chief-of-staff stream while the flag is on. With one
// channel the union's sole option IS the object shape; when a second channel
// lands, replace this with a single object schema carrying a channel enum.
const inputSchema = ComposeHandoffPayloadSchema.options[0]

export const buildComposeHandoffTool = (): LlmStreamTool<
  typeof inputSchema
> => ({
  description:
    'When the official asks to act on an answer — post about it, script it ' +
    'for outreach — call this tool with a drafted text and any context you ' +
    'know from the conversation. Never invent ids or platform-specific ' +
    'details; prefer omitting a field to guessing it. The result opens a ' +
    'prefilled compose drawer for the official to review before anything ' +
    'sends.',
  inputSchema,
  execute: (args) => ComposeHandoffPayloadSchema.parse(args),
})

import { ComposeHandoffPayloadSchema } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'

export const buildComposeHandoffTool = (): LlmStreamTool<
  typeof ComposeHandoffPayloadSchema
> => ({
  description:
    'When the official asks to act on an answer — post about it, script it ' +
    'for outreach — call this tool with a drafted text and any context you ' +
    'know from the conversation. Never invent ids or platform-specific ' +
    'details; prefer omitting a field to guessing it. The result opens a ' +
    'prefilled compose drawer for the official to review before anything ' +
    'sends.',
  inputSchema: ComposeHandoffPayloadSchema,
  execute: (args) => ComposeHandoffPayloadSchema.parse(args),
})

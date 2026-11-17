import {
  assistantModelMessageSchema,
  type AssistantModelMessage,
  type ModelMessage,
  toolModelMessageSchema,
  type ToolModelMessage,
  userModelMessageSchema,
} from 'ai'
import { AgentMessageRole } from '@/generated/prisma'

// One step's token usage, as the AI SDK reports it.
export type StepUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

// An AgentMessage row in the shape the service writes it, before the run id and
// position are attached.
export type AgentMessageRow = {
  role: AgentMessageRole
  parts: unknown
  model?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

type StepMessage = AssistantModelMessage | ToolModelMessage

const hasContent = (message: StepMessage): boolean =>
  Array.isArray(message.content) && message.content.length > 0

// One row per message the step added: the assistant message (its text and tool
// calls) and, when tools ran, the tool message holding their results. The
// assistant row is the step's one model call, so it alone carries the model and
// the token counts; nothing prices them here.
export const stepRows = (
  messages: StepMessage[],
  usage: StepUsage,
  model: string,
): AgentMessageRow[] =>
  messages
    // A reply cut off mid tool call arrives with no content, and the provider
    // refuses to be sent it back.
    .filter(hasContent)
    .map((message) =>
      message.role === 'assistant'
        ? {
            role: AgentMessageRole.assistant,
            parts: message.content,
            model,
            ...usage,
          }
        : { role: AgentMessageRole.tool, parts: message.content },
    )

const textRow = (text: string): AgentMessageRow => ({
  role: AgentMessageRole.user,
  parts: [{ type: 'text', text }],
})

// The run's input is its first message.
export const runInputRow = (input: unknown): AgentMessageRow =>
  textRow(JSON.stringify(input, null, 2))

export const nudgeRow = textRow

// The run so far, in the AI SDK's own message types, ready to hand back to the
// loop. Parsing rather than casting: a row written by an older release is
// either a message the provider accepts or a resume that fails loudly.
export const toModelMessages = (
  rows: { role: AgentMessageRole; parts: unknown }[],
): ModelMessage[] =>
  rows.map((row) => {
    switch (row.role) {
      case AgentMessageRole.assistant:
        return assistantModelMessageSchema.parse({
          role: 'assistant',
          content: row.parts,
        })
      case AgentMessageRole.tool:
        return toolModelMessageSchema.parse({
          role: 'tool',
          content: row.parts,
        })
      default:
        return userModelMessageSchema.parse({
          role: 'user',
          content: row.parts,
        })
    }
  })

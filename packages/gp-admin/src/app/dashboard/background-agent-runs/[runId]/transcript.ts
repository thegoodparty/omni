import type { BackgroundAgentMessage } from '@/shared/gpApi'

export interface ToolCall {
  toolCallId: string
  toolName: string
  input: string
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  output: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringify = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

// The AI SDK's message parts, one array per AgentMessage row: text, tool calls
// on an assistant row and tool results on a tool row. Anything the UI does not
// recognise is dropped rather than rendered as noise.
export const messageText = (message: BackgroundAgentMessage): string =>
  message.parts
    .filter(
      (part): part is { type: 'text'; text: string } =>
        isRecord(part) && part['type'] === 'text'
    )
    .map((part) => part.text ?? '')
    .join('\n')
    .trim()

export const messageToolCalls = (message: BackgroundAgentMessage): ToolCall[] =>
  message.parts
    .filter(
      (part): part is Record<string, unknown> & { type: 'tool-call' } =>
        isRecord(part) && part['type'] === 'tool-call'
    )
    .map((part) => ({
      toolCallId: stringify(part['toolCallId']),
      toolName: stringify(part['toolName']),
      input: stringify(part['input']),
    }))

export const messageToolResults = (
  message: BackgroundAgentMessage
): ToolResult[] =>
  message.parts
    .filter(
      (part): part is Record<string, unknown> & { type: 'tool-result' } =>
        isRecord(part) && part['type'] === 'tool-result'
    )
    .map((part) => ({
      toolCallId: stringify(part['toolCallId']),
      toolName: stringify(part['toolName']),
      output: stringify(part['output']),
    }))

import type { JSONSchema7 } from 'json-schema'

export interface LlmTextPart {
  type: 'text'
  text: string
}

export interface LlmImageUrlPart {
  type: 'image_url'
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
}

export type LlmUserContentPart = LlmTextPart | LlmImageUrlPart

export interface LlmToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface LlmSystemMessage {
  role: 'system'
  content: string | LlmTextPart[]
}

export interface LlmUserMessage {
  role: 'user'
  content: string | LlmUserContentPart[]
}

export interface LlmAssistantMessage {
  role: 'assistant'
  content?: string | LlmTextPart[] | null
  tool_calls?: LlmToolCall[]
}

export interface LlmToolMessage {
  role: 'tool'
  tool_call_id: string
  content: string | LlmTextPart[]
}

export type LlmMessage =
  | LlmSystemMessage
  | LlmUserMessage
  | LlmAssistantMessage
  | LlmToolMessage

export interface LlmFunctionTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: JSONSchema7
  }
}

export type LlmToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } }

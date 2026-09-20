import type { JSONSchema7 } from 'json-schema'

export interface LlmTextPart {
  type: 'text'
  text: string
}

export interface LlmImageUrlPart {
  type: 'image_url'
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
}

// A raw file (e.g. a PDF) handed to the model as a document part. The
// Anthropic provider reads PDFs with vision, scanned pages included — this
// is deliberately narrower than the AI SDK's own FilePart (no URL variant)
// since every current caller has the bytes in hand already.
export interface LlmFilePart {
  type: 'file'
  data: Uint8Array
  mediaType: string
  filename?: string
  // When true, maps to providerOptions.anthropic.citations.enabled on the
  // Anthropic document block. Text-based documents (DOCX, plaintext, link
  // snapshots) set this; PDF/image blocks use native vision and do not need
  // citation enablement at the API level.
  citationsEnabled?: boolean
}

export type LlmUserContentPart = LlmTextPart | LlmImageUrlPart | LlmFilePart

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

// Shared chat data types for the agent chat surfaces. The ai-chat and
// agent-chat client interfaces both build on these so the message, segment,
// error, and stream-event shapes can't drift between surfaces.

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool'

export type ChatMessageSegmentKind = 'text' | 'tool'

export interface ChatMessageSegment {
  kind: ChatMessageSegmentKind
  text?: string | null
  toolName?: string | null
  // Structured tool-call args for widget tool calls (e.g.
  // ask_clarify_question), so the widget replays from the transcript on reload.
  payload?: unknown
}

export interface ChatMessageDto {
  id: string
  conversationId: string
  role: ChatMessageRole
  content: string
  createdAt: string
  segments?: ChatMessageSegment[]
}

export type ChatErrorCode =
  | 'conversation_not_found'
  | 'upstream_unavailable'
  | 'rate_limited'
  | 'aborted'
  | 'internal'

// SSE union streamed by the chat message endpoints. `done`/`error` are
// terminal. `tool_input_start` and `ping` are transient signals a consumer may
// ignore (a per-tool "generating" indicator and an idle keep-alive).
export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_input_start'; toolName: string }
  | { type: 'tool_call'; toolName: string; args?: unknown }
  | { type: 'tool_result'; toolName: string; result?: unknown }
  | { type: 'ping' }
  | { type: 'done'; assistantMessageId?: string }
  | { type: 'error'; code: ChatErrorCode; message: string; retryable: boolean }

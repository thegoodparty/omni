/**
 * Generic chat client interface for AI assistant surfaces (Chief of Staff,
 * AI Campaign Manager, etc.). Each surface provides its own implementation
 * backed by a specific `/v1/chats?scope=<scope>` endpoint.
 */

import type { ChatMessageDto, ChatStreamEvent } from '../agent-chat/chatTypes'
export type {
  ChatMessageRole,
  ChatMessageSegmentKind,
  ChatMessageSegment,
  ChatMessageDto,
  ChatErrorCode,
  ChatStreamEvent,
} from '../agent-chat/chatTypes'

export interface ChatConversationDto {
  conversationId: string
  scope: string
  title: string | null
  ownerUserId: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AiChatClient {
  /** Find-or-create the conversation for the current context. Deferred until first send. */
  createConversation(): Promise<{ conversationId: string }>
  /** Replay prior messages oldest-first. */
  listMessages(conversationId: string): Promise<ChatMessageDto[]>
  /** Conversation history (for the clock-icon popover). */
  listConversations(): Promise<ChatConversationDto[]>
  /** Stream the assistant response over SSE. `done` and `error` are terminal. */
  streamMessage(args: {
    conversationId: string
    content: string
    clientMessageId?: string
    signal?: AbortSignal
  }): AsyncIterable<ChatStreamEvent>
  /** Soft-delete a conversation. */
  softDelete(conversationId: string): Promise<void>
}

export interface AiChatConfig {
  /** Human-readable name shown in the drawer header and aria-labels. */
  title: string
  /** One-line subtitle shown under the title. */
  subtitle?: string
  /** Input placeholder inside the drawer composer. */
  placeholder?: string
  /** Starter prompts shown on a fresh chat. Tapping one sends it. */
  suggestions?: string[]
  /** Hard-coded intro messages typed in on first-ever open. */
  introMessages?: string[]
  /** Tool name → readable status line (e.g. { web_search: 'Searching the web' }). */
  toolDisplayNames?: Record<string, string>
  /** localStorage key for the "intro seen" flag. Must be unique per surface. */
  introSeenKey: string
}

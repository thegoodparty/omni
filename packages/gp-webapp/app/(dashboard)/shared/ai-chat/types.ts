/**
 * Generic chat client interface for AI assistant surfaces (Chief of Staff,
 * AI Campaign Manager, etc.). Each surface provides its own implementation
 * backed by a specific `/v1/chats?scope=<scope>` endpoint.
 */

import type { ChatClient } from '../agent-chat/chatTypes'
export type {
  ChatMessageRole,
  ChatMessageSegmentKind,
  ChatMessageSegment,
  ChatMessageDto,
  ChatConversationDto,
  ChatErrorCode,
  ChatStreamEvent,
  ChatClient,
} from '../agent-chat/chatTypes'

// The ai-chat surfaces use the shared client shape. Their implementations call
// createConversation without an anchor; the optional arg is simply unused.
export type AiChatClient = ChatClient

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

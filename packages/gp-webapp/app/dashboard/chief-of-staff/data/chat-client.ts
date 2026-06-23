/**
 * Interface for the Chief of Staff (general) chat client, consuming slice 3's
 * scope-generic `/v1/chats` endpoints with `scope=chief_of_staff`.
 *
 * Separate from the briefing `ChatClient` (which is annotation-keyed). Here the
 * conversation is keyed by the server on `(ownerUserId, organizationSlug,
 * scope)`, and conversation creation is deferred until the first message is
 * sent — opening + closing an empty chat creates nothing.
 *
 * Real implementation lives in `chat-api.ts`.
 */

import type { ChatAnchor } from '@goodparty_org/contracts'
import type {
  ChatConversationDto,
  ChatMessageDto,
  ChatStreamEvent,
} from './contracts'

export interface ChiefOfStaffChatClient {
  /**
   * Find-or-create the Chief of Staff conversation for the current
   * office/owner. Called lazily on the first send. Returns the conversation
   * id to use for subsequent `streamMessage` / `listMessages` calls.
   */
  createConversation(anchor?: ChatAnchor): Promise<{ conversationId: string }>

  /**
   * Replay the prior messages for a conversation, oldest first. Returns an
   * empty array when the conversation has no messages yet.
   */
  listMessages(conversationId: string): Promise<ChatMessageDto[]>

  /**
   * Conversation history for the scope (the clock-icon list).
   */
  listConversations(): Promise<ChatConversationDto[]>

  /**
   * Send a user message and consume the assistant's streamed response. Treat
   * `done` and `error` as terminal. `clientMessageId` should be a stable UUID
   * across retries so the backend can dedupe.
   */
  streamMessage(args: {
    conversationId: string
    content: string
    clientMessageId?: string
    signal?: AbortSignal
  }): AsyncIterable<ChatStreamEvent>

  /**
   * Soft-delete a conversation. Subsequent calls return
   * `conversation_not_found`.
   */
  softDelete(conversationId: string): Promise<void>
}

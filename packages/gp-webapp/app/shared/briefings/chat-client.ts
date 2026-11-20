/**
 * Interface for the annotation-keyed half of briefing chat, owned by Collin's
 * team.
 *
 * Real implementation lives in chat-api.ts and talks to gp-api over
 * `/v1/briefing-chats`. A localStorage-backed stub lives in chat-stub.ts so
 * the briefing UI keeps working without the backend.
 *
 * Turns and history are NOT here: a briefing conversation is an ordinary
 * `briefing_annotation` conversation, so they go through the shared,
 * scope-parameterized client in
 * `app/dashboard/shared/agent-chat/chatClient.ts`. Only the two calls that are
 * about the annotation — create and delete — are briefing's own.
 */

import type { AnnotationAnchor } from './types'

export interface BriefingChatClient {
  /**
   * Create a briefing-scoped chat. Returns the annotation id that backs the
   * chat row the briefing UI renders, plus the conversation id its turns and
   * history are keyed on.
   *
   * Pass `anchor = { jsonPath: null, start: null, end: null }` for a
   * top-level (briefing-scoped) chat that isn't tied to a text selection.
   */
  createBriefingChat(args: {
    meetingDate: string
    anchor: AnnotationAnchor
  }): Promise<{ annotationId: string; conversationId: string }>

  /**
   * Soft-delete the conversation behind this annotation. The server marks
   * the underlying `ChatConversation` as deleted; subsequent calls return
   * `conversation_not_found`.
   */
  softDelete(annotationId: string): Promise<void>
}

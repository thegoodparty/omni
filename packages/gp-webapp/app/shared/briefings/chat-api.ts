/**
 * Real client for the two annotation-keyed halves of briefing chat, over
 * `/v1/briefing-chats`. Turns and history are conversation-keyed and shared
 * with every other scope, so they use the scope-parameterized
 * `createAgentChatClient` in `app/dashboard/shared/agent-chat/chatClient.ts`
 * instead of a second SSE parser here. SSE shapes are documented in
 * `gp-api/src/chats/CLIENT_HOOKUP.md`.
 *
 * Auth flow: both calls use `clientRequest`, which routes through the
 * same-origin `/api` proxy (Next.js middleware injects the Clerk Bearer token)
 * and attaches the org slug header.
 */

'use client'

import { clientRequest } from 'gpApi/typed-request'
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
   * Soft-delete the conversation behind this annotation. The server marks the
   * underlying `ChatConversation` as deleted; subsequent calls return
   * `conversation_not_found`.
   */
  softDelete(annotationId: string): Promise<void>
}

export const chatApi: BriefingChatClient = {
  async createBriefingChat({ meetingDate, anchor }) {
    const { data } = await clientRequest('POST /v1/briefing-chats', {
      meetingDate,
      anchor,
    })
    return data
  },

  async softDelete(annotationId) {
    await clientRequest('DELETE /v1/briefing-chats/:annotationId', {
      annotationId,
    })
  },
}

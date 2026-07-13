/**
 * Scope-parameterized client for the general (non-annotation) chat over
 * `/v1/chats`. Chief of Staff, Community Issues, and Campaign Manager each bind
 * it to their own `ChatScope`. SSE parsing mirrors the briefing chat client.
 *
 * The JSON calls (create / list / get / delete) go through the typed
 * `clientRequest` helper. The streaming call stays on raw `fetch` through the
 * same-origin `/api` proxy because `ofetch` (clientRequest's transport) buffers
 * the whole response body, which would defeat SSE — so it attaches the org-slug
 * header explicitly.
 */

'use client'

import { getCookie } from 'helpers/cookieHelper'
import {
  ORG_SLUG_COOKIE,
  ORG_SLUG_HEADER,
} from '@shared/organizations/constants'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import type { ChatAnchor } from '@goodparty_org/contracts'

// --- scope-generic chat contracts (integration seam) ------------------------
// Mirrors the planned `@goodparty_org/contracts` chat shapes; see the note in
// chief-of-staff/data/contracts.ts. At integration these re-export from the
// contracts package.

export type ChatScope =
  | 'briefing_annotation'
  | 'chief_of_staff'
  | 'campaign_assistant'
  | 'ordinance_flow'

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool'

export type ChatMessageSegmentKind = 'text' | 'tool'

export interface ChatMessageSegment {
  kind: ChatMessageSegmentKind
  text?: string | null
  toolName?: string | null
  // Structured tool-call args for widget tool calls (e.g. ask_clarify_question),
  // so the widget replays from the transcript on reload.
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

export interface ChatConversationDto {
  conversationId: string
  scope: ChatScope
  title: string | null
  organizationSlug: string | null
  ownerUserId: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ChatConversationListResponse {
  conversations: ChatConversationDto[]
}

export interface ChatConversationMessagesResponse {
  conversationId: string
  messages: ChatMessageDto[]
}

export type ChatErrorCode =
  | 'conversation_not_found'
  | 'upstream_unavailable'
  | 'rate_limited'
  | 'aborted'
  | 'internal'

/**
 * SSE union streamed by `POST /v1/chats/:id/messages`. Treat `done` and
 * `error` as terminal.
 */
export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  // The model has started writing a tool call's arguments (before tool_call).
  // Transient — lets the UI show a per-tool "generating" indicator.
  | { type: 'tool_input_start'; toolName: string }
  | { type: 'tool_call'; toolName: string; args?: unknown }
  | { type: 'tool_result'; toolName: string; result?: unknown }
  | { type: 'done'; assistantMessageId?: string }
  | {
      type: 'error'
      code: ChatErrorCode
      message: string
      retryable: boolean
    }

// --- client interface -------------------------------------------------------

export interface AgentChatClient {
  /**
   * Find-or-create the conversation for the current org/owner (the server keys
   * on scope). Called lazily on the first send.
   */
  createConversation(anchor?: ChatAnchor): Promise<{ conversationId: string }>
  /** Replay prior messages for a conversation, oldest first. */
  listMessages(conversationId: string): Promise<ChatMessageDto[]>
  /** Conversation history for the scope (the clock-icon list). */
  listConversations(): Promise<ChatConversationDto[]>
  /**
   * Send a user message and consume the streamed response. `done`/`error` are
   * terminal; `clientMessageId` is a stable UUID across retries for dedupe.
   */
  streamMessage(args: {
    conversationId: string
    content: string
    clientMessageId?: string
    signal?: AbortSignal
  }): AsyncIterable<ChatStreamEvent>
  /** Soft-delete a conversation. */
  softDelete(conversationId: string): Promise<void>
}

// --- factory ----------------------------------------------------------------

function orgHeaders(): Record<string, string> {
  const slug = getCookie(ORG_SLUG_COOKIE)
  return slug ? { [ORG_SLUG_HEADER]: slug } : {}
}

function errorEvent(
  code: ChatErrorCode,
  message: string,
  retryable: boolean,
): ChatStreamEvent {
  return { type: 'error', code, message, retryable }
}

function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  return (
    type === 'text' ||
    type === 'tool_input_start' ||
    type === 'tool_call' ||
    type === 'tool_result' ||
    type === 'done' ||
    type === 'error'
  )
}

async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const frames = buf.split('\n\n')
      buf = frames.pop() ?? ''
      for (const frame of frames) {
        const trimmed = frame.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const json = trimmed.slice(5).trim()
        if (!json) continue
        let parsed: unknown
        try {
          parsed = JSON.parse(json)
        } catch {
          continue
        }
        if (isChatStreamEvent(parsed)) {
          yield parsed
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore — lock may already be released
    }
  }
}

export function createAgentChatClient(
  scope: ChatScope,
  sentrySurface: string,
): AgentChatClient {
  function statusToErrorEvent(status: number, body: string): ChatStreamEvent {
    if (status === 404) {
      return errorEvent(
        'conversation_not_found',
        'This chat is unavailable. Try starting a new one.',
        false,
      )
    }
    if (status === 429) {
      return errorEvent(
        'rate_limited',
        'Too many requests. Try again in a moment.',
        true,
      )
    }
    if (status >= 500) {
      return errorEvent(
        'upstream_unavailable',
        'Chat is temporarily unavailable.',
        true,
      )
    }
    reportErrorToSentry(new Error(`chat stream non-ok status ${status}`), {
      surface: sentrySurface,
      phase: 'stream',
      status,
      body,
    })
    return errorEvent(
      'internal',
      'Something went wrong. Please try again.',
      false,
    )
  }

  return {
    async createConversation(anchor?: ChatAnchor) {
      const { data } = await clientRequest('POST /v1/chats', { scope, anchor })
      return { conversationId: data.conversationId }
    },

    async listMessages(conversationId) {
      const { data } = await clientRequest('GET /v1/chats/:id', {
        id: conversationId,
        scope,
      })
      return data.messages
    },

    async listConversations(): Promise<ChatConversationDto[]> {
      const { data } = await clientRequest('GET /v1/chats', { scope })
      return data.conversations
    },

    async softDelete(conversationId) {
      await clientRequest('DELETE /v1/chats/:id', {
        id: conversationId,
        scope,
      })
    },

    async *streamMessage({ conversationId, content, clientMessageId, signal }) {
      let res: Response
      try {
        res = await fetch(
          `/api/v1/chats/${encodeURIComponent(conversationId)}/messages?scope=${scope}`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
              ...orgHeaders(),
            },
            body: JSON.stringify({ content, clientMessageId }),
            signal,
          },
        )
      } catch (err) {
        const aborted =
          err instanceof Error &&
          (err.name === 'AbortError' || signal?.aborted === true)
        if (!aborted) {
          reportErrorToSentry(err, {
            surface: sentrySurface,
            phase: 'stream',
            step: 'fetch',
            conversationId,
          })
        }
        yield errorEvent(
          aborted ? 'aborted' : 'upstream_unavailable',
          aborted ? 'Stream cancelled.' : 'Chat is temporarily unavailable.',
          !aborted,
        )
        return
      }

      if (!res.ok) {
        let bodyText = ''
        try {
          bodyText = await res.text()
        } catch {
          bodyText = ''
        }
        yield statusToErrorEvent(res.status, bodyText)
        return
      }

      if (!res.body) {
        yield errorEvent(
          'internal',
          'No response body returned from server.',
          false,
        )
        return
      }

      try {
        for await (const ev of parseSseStream(res.body)) {
          yield ev
          if (ev.type === 'done' || ev.type === 'error') return
        }
      } catch (err) {
        const aborted =
          err instanceof Error &&
          (err.name === 'AbortError' || signal?.aborted === true)
        if (!aborted) {
          reportErrorToSentry(err, {
            surface: sentrySurface,
            phase: 'stream',
            step: 'iterate',
            conversationId,
          })
        }
        yield errorEvent(
          aborted ? 'aborted' : 'internal',
          aborted ? 'Stream cancelled.' : 'Stream interrupted.',
          false,
        )
      }
    },
  }
}

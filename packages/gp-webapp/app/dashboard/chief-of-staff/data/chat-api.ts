/**
 * Real ChiefOfStaffChatClient — talks to gp-api's scope-generic chat over
 * `/v1/chats` with `scope=chief_of_staff`. SSE parsing mirrors the briefing
 * chat client.
 *
 * The JSON calls (create / list / get / delete) go through the typed
 * `clientRequest` helper against the routes registered in
 * `gpApi/api-endpoints.ts`. The streaming call stays on raw `fetch` through the
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
import type { ChiefOfStaffChatClient } from './chat-client'
import type {
  ChatConversationDto,
  ChatErrorCode,
  ChatStreamEvent,
} from './contracts'

const SCOPE = 'chief_of_staff'

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
  reportErrorToSentry(new Error(`cos-chat stream non-ok status ${status}`), {
    surface: 'chief-of-staff-chat',
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

function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  return (
    type === 'text' ||
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

export const chiefOfStaffChatApi: ChiefOfStaffChatClient = {
  async createConversation(anchor?: ChatAnchor) {
    const { data } = await clientRequest('POST /v1/chats', {
      scope: SCOPE,
      anchor,
    })
    return { conversationId: data.conversationId }
  },

  async listMessages(conversationId) {
    const { data } = await clientRequest('GET /v1/chats/:id', {
      id: conversationId,
      scope: SCOPE,
    })
    return data.messages
  },

  async listConversations(): Promise<ChatConversationDto[]> {
    const { data } = await clientRequest('GET /v1/chats', { scope: SCOPE })
    return data.conversations
  },

  async softDelete(conversationId) {
    await clientRequest('DELETE /v1/chats/:id', {
      id: conversationId,
      scope: SCOPE,
    })
  },

  async *streamMessage({ conversationId, content, clientMessageId, signal }) {
    let res: Response
    try {
      res = await fetch(
        `/api/v1/chats/${encodeURIComponent(conversationId)}/messages?scope=${SCOPE}`,
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
          surface: 'chief-of-staff-chat',
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
          surface: 'chief-of-staff-chat',
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

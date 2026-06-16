import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chiefOfStaffChatApi } from './chat-api'
import type { ChatStreamEvent } from './contracts'

type FetchMock = ReturnType<typeof vi.fn>

function asSseResponse(status: number, frames: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const frame of frames) controller.enqueue(enc.encode(frame))
      controller.close()
    },
  })
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function asJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sse(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

describe('chiefOfStaffChatApi', () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // No org-slug cookie in jsdom by default; the client tolerates that.
    document.cookie = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function collect(
    iter: AsyncIterable<ChatStreamEvent>,
  ): Promise<ChatStreamEvent[]> {
    const out: ChatStreamEvent[] = []
    for await (const ev of iter) out.push(ev)
    return out
  }

  describe('createConversation', () => {
    it('POSTs to /v1/chats with the chief_of_staff scope and returns the id', async () => {
      fetchMock.mockResolvedValueOnce(
        asJsonResponse(200, { conversationId: 'conv_1', created: false }),
      )

      const result = await chiefOfStaffChatApi.createConversation()

      expect(result).toEqual({ conversationId: 'conv_1' })
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/v1/chats')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({
        scope: 'chief_of_staff',
      })
    })

    it('throws on a non-2xx response', async () => {
      fetchMock.mockResolvedValueOnce(asJsonResponse(500, { message: 'boom' }))
      await expect(chiefOfStaffChatApi.createConversation()).rejects.toThrow(
        /500/,
      )
    })
  })

  describe('listMessages', () => {
    it('GETs the conversation endpoint and returns its messages', async () => {
      const messages = [
        {
          id: 'm1',
          conversationId: 'conv_1',
          role: 'user' as const,
          content: 'hi',
          createdAt: '2026-06-15T00:00:00.000Z',
        },
      ]
      fetchMock.mockResolvedValueOnce(
        asJsonResponse(200, { conversationId: 'conv_1', messages }),
      )

      const result = await chiefOfStaffChatApi.listMessages('conv_1')

      expect(result).toEqual(messages)
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toBe('/api/v1/chats/conv_1?scope=chief_of_staff')
    })
  })

  describe('listConversations', () => {
    it('GETs /v1/chats scoped to chief_of_staff and returns conversations', async () => {
      const conversations = [
        {
          id: 'conv_1',
          scope: 'chief_of_staff' as const,
          title: 'Budget questions',
          organizationSlug: 'eo-1',
          ownerUserId: 7,
          deletedAt: null,
          createdAt: '2026-06-14T00:00:00.000Z',
          updatedAt: '2026-06-14T00:00:00.000Z',
        },
      ]
      fetchMock.mockResolvedValueOnce(asJsonResponse(200, { conversations }))

      const result = await chiefOfStaffChatApi.listConversations()

      expect(result).toEqual(conversations)
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toBe('/api/v1/chats?scope=chief_of_staff')
    })
  })

  describe('softDelete', () => {
    it('DELETEs the conversation endpoint', async () => {
      fetchMock.mockResolvedValueOnce(asJsonResponse(200, {}))
      await expect(
        chiefOfStaffChatApi.softDelete('conv_1'),
      ).resolves.toBeUndefined()
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/v1/chats/conv_1?scope=chief_of_staff')
      expect(init.method).toBe('DELETE')
    })

    it('throws on a non-2xx response', async () => {
      fetchMock.mockResolvedValueOnce(asJsonResponse(404, {}))
      await expect(chiefOfStaffChatApi.softDelete('conv_x')).rejects.toThrow(
        /404/,
      )
    })
  })

  describe('streamMessage', () => {
    it('POSTs to the messages endpoint and parses text + done frames', async () => {
      fetchMock.mockResolvedValueOnce(
        asSseResponse(200, [
          sse({ type: 'text', delta: 'Hello' }),
          sse({ type: 'text', delta: ' there' }),
          sse({ type: 'done', assistantMessageId: 'asst_1' }),
        ]),
      )

      const events = await collect(
        chiefOfStaffChatApi.streamMessage({
          conversationId: 'conv_1',
          content: 'hi',
          clientMessageId: 'uuid-1',
        }),
      )

      expect(events).toEqual([
        { type: 'text', delta: 'Hello' },
        { type: 'text', delta: ' there' },
        { type: 'done', assistantMessageId: 'asst_1' },
      ])
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/v1/chats/conv_1/messages?scope=chief_of_staff')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({
        content: 'hi',
        clientMessageId: 'uuid-1',
      })
    })

    it('parses tool_call frames as their own events', async () => {
      fetchMock.mockResolvedValueOnce(
        asSseResponse(200, [
          sse({ type: 'tool_call', toolName: 'web_search' }),
          sse({ type: 'text', delta: 'ok' }),
          sse({ type: 'done' }),
        ]),
      )

      const events = await collect(
        chiefOfStaffChatApi.streamMessage({
          conversationId: 'c',
          content: 'q',
        }),
      )

      expect(events.map((e) => e.type)).toEqual(['tool_call', 'text', 'done'])
    })

    it('parses frames split across chunk boundaries', async () => {
      const frame = sse({ type: 'text', delta: 'split' })
      const half = Math.floor(frame.length / 2)
      fetchMock.mockResolvedValueOnce(
        asSseResponse(200, [
          frame.slice(0, half),
          frame.slice(half),
          sse({ type: 'done' }),
        ]),
      )

      const events = await collect(
        chiefOfStaffChatApi.streamMessage({
          conversationId: 'c',
          content: 'q',
        }),
      )

      expect(events).toEqual([
        { type: 'text', delta: 'split' },
        { type: 'done' },
      ])
    })

    it('maps a 404 before streaming to a non-retryable conversation_not_found error', async () => {
      fetchMock.mockResolvedValueOnce(asJsonResponse(404, { message: 'gone' }))

      const events = await collect(
        chiefOfStaffChatApi.streamMessage({
          conversationId: 'c',
          content: 'q',
        }),
      )

      expect(events).toHaveLength(1)
      const first = events[0]
      expect(first?.type).toBe('error')
      if (first?.type === 'error') {
        expect(first.code).toBe('conversation_not_found')
        expect(first.retryable).toBe(false)
      }
    })

    it('forwards the AbortSignal to fetch', async () => {
      fetchMock.mockResolvedValueOnce(
        asSseResponse(200, [sse({ type: 'done' })]),
      )
      const ctrl = new AbortController()

      await collect(
        chiefOfStaffChatApi.streamMessage({
          conversationId: 'c',
          content: 'q',
          signal: ctrl.signal,
        }),
      )

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit
      expect(init.signal).toBe(ctrl.signal)
    })
  })
})

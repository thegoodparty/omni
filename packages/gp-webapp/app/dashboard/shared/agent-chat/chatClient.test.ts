import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentChatClient, type ChatStreamEvent } from './chatClient'

const { reportClientError, reportClientInterruption } = vi.hoisted(() => ({
  reportClientError: vi.fn(),
  reportClientInterruption: vi.fn(),
}))

vi.mock('@shared/observability/reportClientError', () => ({
  reportClientError,
  reportClientInterruption,
}))

const sseResponse = (frames: string[]): Response => {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

// A connection that serves one frame and then drops, the way Chrome reports a
// body read losing its socket: a TypeError, not an AbortError.
const droppedSseResponse = (frames: string[]): Response => {
  const encoder = new TextEncoder()
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const frame = frames[sent]
      if (frame === undefined) {
        controller.error(new TypeError('network error'))
        return
      }
      sent += 1
      controller.enqueue(encoder.encode(frame))
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

const collect = async (
  iterable: AsyncIterable<ChatStreamEvent>,
): Promise<ChatStreamEvent[]> => {
  const out: ChatStreamEvent[] = []
  for await (const event of iterable) out.push(event)
  return out
}

describe('createAgentChatClient streamMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  // ENG-11724. A body read that rejects after a 200 is the connection, so the
  // turn must end without an error event (the caller reconciles with the
  // persisted turn) and the failure must not reach the exception stream.
  it('ends a dropped stream without an error event or a reported error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          droppedSseResponse(['data: {"type":"text","delta":"hi"}\n\n']),
        ),
    )
    const client = createAgentChatClient('campaign_assistant', 'test-surface')
    const events = await collect(
      client.streamMessage({ conversationId: 'c1', content: 'hello' }),
    )

    expect(events.map((e) => e.type)).toEqual(['text'])
    expect(reportClientError).not.toHaveBeenCalled()
    expect(reportClientInterruption).toHaveBeenCalledWith(
      'chat stream interrupted',
      {
        surface: 'test-surface',
        phase: 'stream',
        step: 'iterate',
        conversationId: 'c1',
      },
    )
  })

  it('yields ping keep-alive events so idle watchdogs reset', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            'data: {"type":"ping"}\n\n',
            'data: {"type":"text","delta":"hi"}\n\n',
            'data: {"type":"done","assistantMessageId":"m1"}\n\n',
          ]),
        ),
    )
    const client = createAgentChatClient('ordinance_flow', 'test-surface')
    const events = await collect(
      client.streamMessage({ conversationId: 'c1', content: 'hello' }),
    )
    expect(events.map((e) => e.type)).toEqual(['ping', 'text', 'done'])
  })

  it('sends the page the message was sent from', async () => {
    window.history.pushState({}, '', '/dashboard/contacts')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse(['data: {"type":"done"}\n\n']))
    vi.stubGlobal('fetch', fetchMock)
    const client = createAgentChatClient('campaign_assistant', 'test-surface')
    await collect(
      client.streamMessage({ conversationId: 'c1', content: 'hello' }),
    )
    const [, init] = fetchMock.mock.calls[0] as [unknown, { body?: string }]
    expect(JSON.parse(init.body ?? '{}')).toMatchObject({
      pagePath: '/dashboard/contacts',
    })
  })

  it('drops frames with unknown event types instead of failing the stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            'data: {"type":"someday_new_event"}\n\n',
            'data: {"type":"text","delta":"hi"}\n\n',
            'data: {"type":"done"}\n\n',
          ]),
        ),
    )
    const client = createAgentChatClient('ordinance_flow', 'test-surface')
    const events = await collect(
      client.streamMessage({ conversationId: 'c1', content: 'hello' }),
    )
    expect(events.map((e) => e.type)).toEqual(['text', 'done'])
  })

  it('yields citation events so callers can render inline chips', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            'data: {"type":"text","delta":"See "}\n\n',
            'data: {"type":"citation","attachmentId":"att-1","page":3,"quotedText":"the plan"}\n\n',
            'data: {"type":"done","assistantMessageId":"m2"}\n\n',
          ]),
        ),
    )
    const client = createAgentChatClient('chief_of_staff', 'test-surface')
    const events = await collect(
      client.streamMessage({ conversationId: 'c1', content: 'hello' }),
    )
    expect(events.map((e) => e.type)).toEqual(['text', 'citation', 'done'])
    const citationEvent = events.find((e) => e.type === 'citation')
    expect(citationEvent?.type).toBe('citation')
    if (citationEvent?.type === 'citation') {
      expect(citationEvent.attachmentId).toBe('att-1')
      expect(citationEvent.page).toBe(3)
    }
  })
})

// Regression: `scope` is a query param on every chat route, but clientRequest
// routes a non-GET/DELETE payload into the body. Sending the rating without
// the explicit query override left the server's @Query() empty, so every
// thumbs-up/down 400'd — the thumb reverted and the note panel flashed shut.
describe('createAgentChatClient message feedback', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const captureRequest = (): ReturnType<typeof vi.fn> => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const requestedUrl = (fetchMock: ReturnType<typeof vi.fn>): string => {
    const [target] = fetchMock.mock.calls[0] as [string | Request]
    return typeof target === 'string' ? target : target.url
  }

  it('sends scope in the query string when recording a rating', async () => {
    const fetchMock = captureRequest()
    const client = createAgentChatClient('chief_of_staff', 'test-surface')

    await client.setMessageFeedback?.({
      conversationId: 'conv_1',
      messageId: 'asst_1',
      feedback: 'negative',
      comment: 'Wrong meeting.',
    })

    const url = requestedUrl(fetchMock)
    expect(url).toContain('/v1/chats/conv_1/messages/asst_1/feedback')
    expect(url).toContain('scope=chief_of_staff')
  })

  it('sends scope in the query string when retracting a rating', async () => {
    const fetchMock = captureRequest()
    const client = createAgentChatClient('campaign_assistant', 'test-surface')

    await client.clearMessageFeedback?.({
      conversationId: 'conv_2',
      messageId: 'asst_2',
    })

    const url = requestedUrl(fetchMock)
    expect(url).toContain('/v1/chats/conv_2/messages/asst_2/feedback')
    expect(url).toContain('scope=campaign_assistant')
  })

  it('keeps the rating out of the query and in the body', async () => {
    const fetchMock = captureRequest()
    const client = createAgentChatClient('chief_of_staff', 'test-surface')

    await client.setMessageFeedback?.({
      conversationId: 'conv_3',
      messageId: 'asst_3',
      feedback: 'positive',
      comment: null,
    })

    const [, init] = fetchMock.mock.calls[0] as [unknown, { body?: string }]
    expect(JSON.parse(init.body ?? '{}')).toEqual({
      feedback: 'positive',
      comment: null,
    })
  })
})

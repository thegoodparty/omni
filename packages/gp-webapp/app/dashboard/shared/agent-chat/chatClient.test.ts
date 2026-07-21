import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentChatClient, type ChatStreamEvent } from './chatClient'

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
})

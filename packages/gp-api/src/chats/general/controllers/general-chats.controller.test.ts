import type { FastifyReply, FastifyRequest } from 'fastify'
import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { Organization, User } from '../../../generated/prisma'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import type { ChatStreamChunk } from '@/chats/services/chatStream.service'
import type { GeneralChatsService } from '../services/general-chats.service'
import type {
  ChatHistoryQueryDto,
  SendChatMessageDto,
} from '../schemas/GeneralChat.schema'
import { GeneralChatsController } from './general-chats.controller'

class StreamableReply extends EventEmitter {
  public writes: string[] = []
  public ended = false
  public writeReturn = true
  writeHead = vi.fn()
  write = vi.fn((chunk: string) => {
    this.writes.push(chunk)
    return this.writeReturn
  })
  end = vi.fn(() => {
    this.ended = true
  })
}

const buildReq = (): FastifyRequest =>
  ({ raw: new EventEmitter() }) as unknown as FastifyRequest

const buildIterable = (
  chunks: ChatStreamChunk[],
): AsyncIterable<ChatStreamChunk> => ({
  [Symbol.asyncIterator]: async function* () {
    for (const c of chunks) yield c
  },
})

const buildService = (
  iterable: AsyncIterable<ChatStreamChunk>,
): GeneralChatsService =>
  ({
    assertConversationAccessible: vi.fn(() => Promise.resolve()),
    sendMessage: vi.fn(() => iterable),
  }) as unknown as GeneralChatsService

const USER = { id: 7 } as unknown as User
const ORG = { slug: 'eo-1' } as unknown as Organization
const QUERY = { scope: 'ordinance_flow' } as unknown as ChatHistoryQueryDto
const BODY = { content: 'hi' } as unknown as SendChatMessageDto

describe('GeneralChatsController.streamMessage backpressure', () => {
  it('stops awaiting drain and writes through the rest when the client stalls', async () => {
    vi.useFakeTimers()
    // Every write backpressures and the client never drains (idle/backgrounded
    // tab): the stream must not wedge until the 300s request timeout — it stalls
    // out and writes the remaining chunks through so the turn completes.
    const raw = new StreamableReply()
    raw.writeReturn = false
    const reply = { raw } as unknown as FastifyReply
    const controller = new GeneralChatsController(
      buildService(
        buildIterable([
          { type: 'text', delta: 'a' },
          { type: 'text', delta: 'b' },
          { type: 'done' },
        ]),
      ),
      createMockLogger(),
    )

    const p = controller.streamMessage(
      USER,
      ORG,
      'conv-1',
      QUERY,
      BODY,
      buildReq(),
      reply,
    )
    // Advance past the stall timeout (but not the 300s request timeout).
    await vi.advanceTimersByTimeAsync(15_001)
    await p
    vi.useRealTimers()

    expect(raw.writes).toHaveLength(3)
    expect(raw.ended).toBe(true)
    expect(raw.writes.some((w) => w.includes('"type":"error"'))).toBe(false)
  })
})

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

const buildReq = (): { req: FastifyRequest; emitter: EventEmitter } => {
  const emitter = new EventEmitter()
  return { req: { raw: emitter } as unknown as FastifyRequest, emitter }
}

const buildIterable = (
  chunks: ChatStreamChunk[],
): AsyncIterable<ChatStreamChunk> => ({
  [Symbol.asyncIterator]: async function* () {
    for (const c of chunks) yield c
  },
})

const buildService = (
  iterable: AsyncIterable<ChatStreamChunk>,
  onCall?: (args: { signal?: AbortSignal }) => void,
): GeneralChatsService =>
  ({
    assertConversationAccessible: vi.fn(() => Promise.resolve()),
    sendMessage: vi.fn((args: { signal?: AbortSignal }) => {
      onCall?.(args)
      return iterable
    }),
  }) as unknown as GeneralChatsService

const USER = { id: 7 } as unknown as User
const ORG = { slug: 'eo-1' } as unknown as Organization
const QUERY = { scope: 'ordinance_flow' } as unknown as ChatHistoryQueryDto
const BODY = { content: 'hi' } as unknown as SendChatMessageDto

const run = (
  controller: GeneralChatsController,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> =>
  controller.streamMessage(USER, ORG, 'conv-1', QUERY, BODY, req, reply)

describe('GeneralChatsController.streamMessage', () => {
  it('writes all chunks and ends the stream when writes flush immediately', async () => {
    const raw = new StreamableReply()
    const reply = { raw } as unknown as FastifyReply
    const controller = new GeneralChatsController(
      buildService(
        buildIterable([{ type: 'text', delta: 'hello' }, { type: 'done' }]),
      ),
      createMockLogger(),
    )

    await run(controller, buildReq().req, reply)

    expect(raw.writes).toHaveLength(2)
    expect(raw.writes.some((w) => w.includes('"type":"error"'))).toBe(false)
    expect(raw.ended).toBe(true)
  })

  it('writes an internal error chunk and ends when the iterable throws', async () => {
    const raw = new StreamableReply()
    const reply = { raw } as unknown as FastifyReply
    const logger = createMockLogger()
    const throwing: AsyncIterable<ChatStreamChunk> = {
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'text', delta: 'partial' }
        throw new Error('upstream blew up')
      },
    }
    const controller = new GeneralChatsController(
      buildService(throwing),
      logger,
    )

    await run(controller, buildReq().req, reply)

    expect(
      raw.writes.some(
        (w) => w.includes('"type":"error"') && w.includes('"code":"internal"'),
      ),
    ).toBe(true)
    expect(raw.ended).toBe(true)
    expect(logger.error).toHaveBeenCalled()
  })

  it('aborts mid-stream and ends when the request connection closes', async () => {
    const signalRef: { signal?: AbortSignal } = {}
    const longStream = async function* (): AsyncGenerator<ChatStreamChunk> {
      for (let i = 0; i < 20; i++) {
        if (signalRef.signal?.aborted) return
        yield { type: 'text', delta: `chunk-${i}` }
        await new Promise<void>((r) => setImmediate(r))
      }
    }
    const raw = new StreamableReply()
    const reply = { raw } as unknown as FastifyReply
    const controller = new GeneralChatsController(
      buildService({ [Symbol.asyncIterator]: () => longStream() }, (args) => {
        signalRef.signal = args.signal
      }),
      createMockLogger(),
    )
    const { req, emitter } = buildReq()

    const closeMidStream = (async () => {
      await new Promise<void>((r) => setImmediate(r))
      await new Promise<void>((r) => setImmediate(r))
      emitter.emit('close')
    })()

    await run(controller, req, reply)
    await closeMidStream

    expect(signalRef.signal?.aborted).toBe(true)
    expect(raw.writes.length).toBeLessThan(20)
    expect(raw.ended).toBe(true)
  })

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

    const p = run(controller, buildReq().req, reply)
    // Advance past the stall timeout (but not the 300s request timeout).
    await vi.advanceTimersByTimeAsync(15_001)
    await p
    vi.useRealTimers()

    expect(raw.writes).toHaveLength(3)
    expect(raw.ended).toBe(true)
    expect(raw.writes.some((w) => w.includes('"type":"error"'))).toBe(false)
  })
})

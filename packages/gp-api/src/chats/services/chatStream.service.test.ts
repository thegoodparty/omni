import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import {
  ChatConversation,
  ChatMessage,
  ChatMessageRole,
} from '../../generated/prisma'
import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import type {
  LlmStreamOptions,
  LlmStreamResult,
  LlmStreamTool,
  LlmStreamUsage,
} from '@/llm/services/llm.service'
import { LlmService } from '@/llm/services/llm.service'
import {
  CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER,
  ChatStreamService,
  ChatStreamChunk,
  MAX_BUFFERED_CHUNKS,
  MAX_CHAT_HISTORY_MESSAGES,
} from './chatStream.service'
import type { ChatStoreService, PersistedSegment } from './chatStore.prisma'
import { BraintrustService } from 'src/vendors/braintrust/braintrust.service'

const DEFAULT_SYS = 'sys'
const SAMPLE_USER = 'q'
const CONVERSATION_ID = 'c1'
const OWNER_ID = 1
const EXPECTED_ERROR_CHUNK = 'expected error chunk'

interface FakeConversationSeed {
  id: string
  ownerUserId: number
  deletedAt?: Date | null
}

interface AppendArgs {
  conversationId: string
  role: ChatMessageRole
  content: string
  clientMessageId?: string
  segments?: PersistedSegment[]
}

class FakeChatStore {
  private conversations = new Map<string, ChatConversation>()
  private messagesByConversation = new Map<string, ChatMessage[]>()
  private nextMessageId = 1
  public events: string[] = []
  public lastListRecentLimit: number | undefined
  public listRecentCalls = 0
  public deletedBeforeUserAppend = false
  public lastAppendedSegments: PersistedSegment[] | undefined

  seedConversation(seed: FakeConversationSeed): ChatConversation {
    const row: ChatConversation = {
      id: seed.id,
      ownerUserId: seed.ownerUserId,
      title: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: seed.deletedAt ?? null,
    } as ChatConversation
    this.conversations.set(seed.id, row)
    if (!this.messagesByConversation.has(seed.id)) {
      this.messagesByConversation.set(seed.id, [])
    }
    return row
  }

  seedMessage(args: {
    conversationId: string
    role: ChatMessageRole
    content: string
    createdAt?: Date
  }): ChatMessage {
    const row: ChatMessage = {
      id: `seed-${this.nextMessageId++}`,
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      clientMessageId: null,
      createdAt: args.createdAt ?? new Date(),
    } as unknown as ChatMessage
    const list = this.messagesByConversation.get(args.conversationId) ?? []
    list.push(row)
    this.messagesByConversation.set(args.conversationId, list)
    return row
  }

  findConversationByIdAndOwner(
    id: string,
    ownerUserId: number,
  ): Promise<ChatConversation | null> {
    this.events.push('findConversationByIdAndOwner')
    const row = this.conversations.get(id)
    if (!row) return Promise.resolve(null)
    if (row.ownerUserId !== ownerUserId) return Promise.resolve(null)
    if (row.deletedAt !== null) return Promise.resolve(null)
    return Promise.resolve(row)
  }

  listMessagesByConversation(conversationId: string): Promise<ChatMessage[]> {
    const list = this.messagesByConversation.get(conversationId) ?? []
    return Promise.resolve([...list])
  }

  listRecentMessagesByConversation(
    conversationId: string,
    limit: number,
  ): Promise<ChatMessage[]> {
    this.listRecentCalls += 1
    this.lastListRecentLimit = limit
    this.events.push('listRecentMessagesByConversation')
    const list = this.messagesByConversation.get(conversationId) ?? []
    const sliced = list.slice(Math.max(0, list.length - limit))
    return Promise.resolve([...sliced])
  }

  appendUserMessageIfAlive(args: {
    conversationId: string
    ownerUserId: number
    content: string
    clientMessageId?: string
  }): Promise<ChatMessage | null> {
    this.events.push('appendUserMessageIfAlive')
    if (this.deletedBeforeUserAppend) {
      const row = this.conversations.get(args.conversationId)
      if (row) row.deletedAt = new Date()
    }
    const row = this.conversations.get(args.conversationId)
    if (!row) return Promise.resolve(null)
    if (row.ownerUserId !== args.ownerUserId) return Promise.resolve(null)
    if (row.deletedAt !== null) return Promise.resolve(null)
    return this.appendMessage({
      conversationId: args.conversationId,
      role: ChatMessageRole.user,
      content: args.content,
      ...(args.clientMessageId !== undefined && {
        clientMessageId: args.clientMessageId,
      }),
    })
  }

  appendMessage(args: AppendArgs): Promise<ChatMessage> {
    this.events.push(`appendMessage:${args.role}`)
    if (args.segments !== undefined) this.lastAppendedSegments = args.segments
    if (args.clientMessageId !== undefined) {
      const list = this.messagesByConversation.get(args.conversationId) ?? []
      const existing = list.find(
        (m) =>
          (m as unknown as { clientMessageId: string | null })
            .clientMessageId === args.clientMessageId,
      )
      if (existing) return Promise.resolve(existing)
    }
    const row: ChatMessage = {
      id: `msg-${this.nextMessageId++}`,
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      clientMessageId: args.clientMessageId ?? null,
      createdAt: new Date(),
    } as unknown as ChatMessage
    const list = this.messagesByConversation.get(args.conversationId) ?? []
    list.push(row)
    this.messagesByConversation.set(args.conversationId, list)
    return Promise.resolve(row)
  }

  softDeleteConversation(): Promise<void> {
    return Promise.resolve()
  }

  getPersistedMessages(conversationId: string): ChatMessage[] {
    return [...(this.messagesByConversation.get(conversationId) ?? [])]
  }

  asService(): ChatStoreService {
    return this as unknown as ChatStoreService
  }
}

type StreamScriptItem =
  | { kind: 'text'; delta: string }
  | { kind: 'toolInputStart'; toolName: string }
  | {
      kind: 'toolCall'
      name: string
      input: Record<string, unknown>
      output: Record<string, unknown>
    }
  | { kind: 'error'; error: Error }
  // Models the AI SDK routing a mid-generation error to onError (via
  // onStreamError) rather than throwing from textStream, which then ends.
  | { kind: 'streamError'; error: Error }
  | { kind: 'abortCheck' }
  | { kind: 'gate'; gate: Promise<void> }

interface FakeLlmStreamCall {
  options: LlmStreamOptions
}

const consumeScriptItem = async (
  item: StreamScriptItem,
  options: LlmStreamOptions,
  textChunks: string[],
  toolCallIds: string[],
): Promise<{ done: boolean; yieldText?: string }> => {
  if (item.kind === 'abortCheck') {
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
    return { done: options.abortSignal?.aborted ?? false }
  }
  if (item.kind === 'gate') {
    await item.gate
    return { done: options.abortSignal?.aborted ?? false }
  }
  if (item.kind === 'text') {
    textChunks.push(item.delta)
    return { done: false, yieldText: item.delta }
  }
  if (item.kind === 'toolInputStart') {
    options.onToolInputStart?.({ toolName: item.toolName })
    return { done: false }
  }
  if (item.kind === 'streamError') {
    options.onStreamError?.(item.error)
    return { done: true }
  }
  if (item.kind === 'toolCall') {
    const id = `call-${toolCallIds.length + 1}`
    toolCallIds.push(id)
    options.onToolCallStart?.({ name: item.name, input: item.input })
    options.onToolCallEnd?.({
      name: item.name,
      input: item.input,
      output: item.output,
    })
    return { done: false }
  }
  throw item.error
}

class FakeLlmService {
  public calls: FakeLlmStreamCall[] = []
  public events: string[] = []
  private script: StreamScriptItem[] = []
  private model = 'fake-model-x'
  private connectError: Error | undefined

  setScript(script: StreamScriptItem[]): void {
    this.script = script
  }

  setConnectError(err: Error): void {
    this.connectError = err
  }

  streamChatCompletion(options: LlmStreamOptions): Promise<LlmStreamResult> {
    this.calls.push({ options })
    this.events.push('streamChatCompletion')
    if (this.connectError) return Promise.reject(this.connectError)
    const script = this.script
    const model = this.model

    const textChunks: string[] = []
    const toolCallIds: string[] = []

    const textStream: AsyncIterable<string> = {
      [Symbol.asyncIterator]: async function* () {
        for (const item of script) {
          if (options.abortSignal?.aborted) return
          const r = await consumeScriptItem(
            item,
            options,
            textChunks,
            toolCallIds,
          )
          if (r.done) return
          if (r.yieldText !== undefined) yield r.yieldText
        }
      },
    }

    const finalText = Promise.resolve(textChunks.join(''))
    const usage: Promise<LlmStreamUsage> = Promise.resolve({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    })
    const toolCalls = Promise.resolve(
      script
        .filter(
          (s): s is Extract<StreamScriptItem, { kind: 'toolCall' }> =>
            s.kind === 'toolCall',
        )
        .map((s, idx) => ({
          id: `call-${idx + 1}`,
          type: 'function',
          function: { name: s.name, arguments: JSON.stringify(s.input) },
        })),
    )

    return Promise.resolve({
      textStream,
      finalText,
      toolCalls,
      usage,
      model,
    })
  }
}

const collect = async (
  iter: AsyncIterable<ChatStreamChunk>,
): Promise<ChatStreamChunk[]> => {
  const out: ChatStreamChunk[] = []
  for await (const c of iter) out.push(c)
  return out
}

const waitForCondition = async (
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> => {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitForCondition timed out')
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
}

const fakeTool: LlmStreamTool = {
  description: 'fake tool',
  inputSchema: {
    parse: <T>(v: T): T => v,
  } as unknown as LlmStreamTool['inputSchema'],
  execute: (input) => input,
}

const baseStreamArgs = (
  overrides: Partial<{
    conversationId: string
    ownerUserId: number
    userMessage: string
    tools: Record<string, LlmStreamTool>
    signal: AbortSignal
    clientMessageId: string
    maxSteps: number
  }> = {},
) => ({
  conversationId: overrides.conversationId ?? CONVERSATION_ID,
  ownerUserId: overrides.ownerUserId ?? OWNER_ID,
  systemPrompt: DEFAULT_SYS,
  tools: overrides.tools ?? {},
  userMessage: overrides.userMessage ?? SAMPLE_USER,
  ...(overrides.signal && { signal: overrides.signal }),
  ...(overrides.clientMessageId !== undefined && {
    clientMessageId: overrides.clientMessageId,
  }),
  ...(overrides.maxSteps !== undefined && { maxSteps: overrides.maxSteps }),
})

const expectErrorChunk = (chunks: ChatStreamChunk[]) => {
  const chunk = chunks.find((c) => c.type === 'error')
  if (chunk?.type !== 'error') throw new Error(EXPECTED_ERROR_CHUNK)
  return chunk
}

describe('ChatStreamService', () => {
  let store: FakeChatStore
  let llm: FakeLlmService
  let service: ChatStreamService

  beforeEach(() => {
    store = new FakeChatStore()
    llm = new FakeLlmService()
    service = new ChatStreamService(
      store.asService(),
      llm as unknown as LlmService,
      createMockLogger(),
    )
  })

  describe('ownership / lookup', () => {
    it('yields conversation_not_found when conversation does not exist', async () => {
      const chunks = await collect(
        service.stream(baseStreamArgs({ conversationId: 'nope' })),
      )
      expect(chunks).toHaveLength(1)
      const errorChunk = expectErrorChunk(chunks)
      expect(errorChunk.code).toBe('conversation_not_found')
      expect(errorChunk.retryable).toBe(false)
      expect(errorChunk.message).toBeTruthy()
      expect(llm.calls).toHaveLength(0)
    })

    it('yields conversation_not_found when ownerUserId mismatches', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: 999 })
      const chunks = await collect(service.stream(baseStreamArgs()))
      expect(expectErrorChunk(chunks).code).toBe('conversation_not_found')
      expect(llm.calls).toHaveLength(0)
    })

    it('yields conversation_not_found when conversation is soft-deleted', async () => {
      store.seedConversation({
        id: CONVERSATION_ID,
        ownerUserId: OWNER_ID,
        deletedAt: new Date(),
      })
      const chunks = await collect(service.stream(baseStreamArgs()))
      expect(expectErrorChunk(chunks).code).toBe('conversation_not_found')
      expect(llm.calls).toHaveLength(0)
    })

    it('yields conversation_not_found when conversation is soft-deleted between check and user-message write', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      store.deletedBeforeUserAppend = true

      const chunks = await collect(service.stream(baseStreamArgs()))

      expect(expectErrorChunk(chunks).code).toBe('conversation_not_found')
      expect(llm.calls).toHaveLength(0)
      const persisted = store.getPersistedMessages(CONVERSATION_ID)
      expect(persisted).toHaveLength(0)
    })
  })

  describe('happy path', () => {
    it('folds a leading assistant greeting into the system prompt (user-first)', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      store.seedMessage({
        conversationId: CONVERSATION_ID,
        role: ChatMessageRole.assistant,
        content: "Hi, I'm your campaign manager.",
      })
      llm.setScript([{ kind: 'text', delta: 'ok' }])

      await collect(service.stream(baseStreamArgs({ userMessage: 'hello' })))

      const { messages } = firstOrThrow(llm.calls).options
      // Anthropic requires the first non-system turn to be the user, so a seeded
      // assistant greeting is folded into the system prompt, not sent as an
      // invalid leading assistant turn.
      expect(messages[0]?.role).toBe('system')
      expect(String(messages[0]?.content)).toContain(
        "Hi, I'm your campaign manager.",
      )
      expect(messages[1]?.role).toBe('user')
      expect(messages.some((m) => m.role === 'assistant')).toBe(false)
    })

    it('drops a persisted widget-only turn (empty content) from replayed history', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      store.seedMessage({
        conversationId: CONVERSATION_ID,
        role: ChatMessageRole.user,
        content: 'what do peer cities do?',
      })
      // A prior turn that only presented a widget persists with empty content
      // (tool segments aren't replayed). Sending it as `{content: ''}` makes
      // Anthropic 400 ("text content blocks must be non-empty"), so it must be
      // omitted from the history handed to the model.
      store.seedMessage({
        conversationId: CONVERSATION_ID,
        role: ChatMessageRole.assistant,
        content: '',
      })
      llm.setScript([{ kind: 'text', delta: 'ok' }])

      await collect(service.stream(baseStreamArgs({ userMessage: 'and now?' })))

      const { messages } = firstOrThrow(llm.calls).options
      const emptyAssistant = messages.filter(
        (m) => m.role === 'assistant' && m.content === '',
      )
      expect(emptyAssistant).toHaveLength(0)
    })

    it('records appendMessage:user before streamChatCompletion', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'hi' }])

      const events: string[] = []
      const origAppend = store.appendMessage.bind(store)
      store.appendMessage = (args: AppendArgs) => {
        events.push(`store:appendMessage:${args.role}`)
        return origAppend(args)
      }
      const origStream = llm.streamChatCompletion.bind(llm)
      llm.streamChatCompletion = (opts: LlmStreamOptions) => {
        events.push('llm:streamChatCompletion')
        return origStream(opts)
      }

      await collect(service.stream(baseStreamArgs({ userMessage: 'hello' })))

      const userIdx = events.indexOf('store:appendMessage:user')
      const llmIdx = events.indexOf('llm:streamChatCompletion')
      expect(userIdx).toBeGreaterThanOrEqual(0)
      expect(llmIdx).toBeGreaterThanOrEqual(0)
      expect(userIdx).toBeLessThan(llmIdx)
    })

    it('passes the persisted user message in history to llm', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'ok' }])

      await collect(
        service.stream(baseStreamArgs({ userMessage: 'hello world' })),
      )

      expect(llm.calls).toHaveLength(1)
      const sent = firstOrThrow(llm.calls).options.messages
      const userMessages = sent.filter((m) => m.role === 'user')
      expect(userMessages).toHaveLength(1)
      const first = firstOrThrow(userMessages)
      expect(
        typeof first.content === 'string'
          ? first.content
          : JSON.stringify(first.content),
      ).toContain('hello world')
    })

    it('forwards text-delta chunks 1:1 to caller', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([
        { kind: 'text', delta: 'foo ' },
        { kind: 'text', delta: 'bar' },
      ])

      const chunks = await collect(service.stream(baseStreamArgs()))

      const textDeltas = chunks.filter((c) => c.type === 'text')
      expect(textDeltas).toEqual([
        { type: 'text', delta: 'foo ' },
        { type: 'text', delta: 'bar' },
      ])
    })

    it('persists assembled assistant message exactly once on finish', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([
        { kind: 'text', delta: 'Hello ' },
        { kind: 'text', delta: 'world' },
      ])

      await collect(service.stream(baseStreamArgs()))

      const persisted = store.getPersistedMessages(CONVERSATION_ID)
      const assistantRows = persisted.filter(
        (m) => m.role === ChatMessageRole.assistant,
      )
      expect(assistantRows).toHaveLength(1)
      expect(assistantRows[0]?.content).toBe('Hello world')
    })

    it('yields done chunk with assistantMessageId matching persisted row', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'a' }])

      const chunks = await collect(service.stream(baseStreamArgs()))

      const done = chunks.find((c) => c.type === 'done')
      if (done?.type !== 'done') throw new Error('expected done chunk')
      const persisted = store.getPersistedMessages(CONVERSATION_ID)
      const assistantRow = persisted.find(
        (m) => m.role === ChatMessageRole.assistant,
      )
      expect(done.assistantMessageId).toBe(assistantRow?.id)
    })
  })

  describe('history cap', () => {
    it('asks chatStore for at most MAX_CHAT_HISTORY_MESSAGES recent messages', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'ok' }])

      await collect(service.stream(baseStreamArgs()))

      expect(store.listRecentCalls).toBe(1)
      expect(store.lastListRecentLimit).toBe(MAX_CHAT_HISTORY_MESSAGES)
    })

    it('only includes the limited history in the messages sent to llm', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      for (let i = 0; i < MAX_CHAT_HISTORY_MESSAGES + 5; i++) {
        store.seedMessage({
          conversationId: CONVERSATION_ID,
          role: ChatMessageRole.user,
          content: `older-${i}`,
        })
      }
      llm.setScript([{ kind: 'text', delta: 'ok' }])

      await collect(service.stream(baseStreamArgs({ userMessage: 'newest' })))

      const sent = firstOrThrow(llm.calls).options.messages
      const userMessages = sent.filter((m) => m.role === 'user')
      expect(userMessages.length).toBeLessThanOrEqual(MAX_CHAT_HISTORY_MESSAGES)
    })
  })

  describe('idempotency via clientMessageId', () => {
    it('forwards clientMessageId to appendMessage for the user row only', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'ok' }])
      const appendArgsSeen: AppendArgs[] = []
      const origAppend = store.appendMessage.bind(store)
      store.appendMessage = (args: AppendArgs) => {
        appendArgsSeen.push(args)
        return origAppend(args)
      }

      await collect(
        service.stream(baseStreamArgs({ clientMessageId: 'client-xyz' })),
      )

      const userAppend = appendArgsSeen.find(
        (a) => a.role === ChatMessageRole.user,
      )
      const assistantAppend = appendArgsSeen.find(
        (a) => a.role === ChatMessageRole.assistant,
      )
      expect(userAppend?.clientMessageId).toBe('client-xyz')
      expect(assistantAppend?.clientMessageId).toBeUndefined()
    })

    it('does not double-persist user message when same clientMessageId is sent twice', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'ok' }])
      await collect(
        service.stream(
          baseStreamArgs({
            userMessage: 'first-text',
            clientMessageId: 'dupe-1',
          }),
        ),
      )

      llm.setScript([{ kind: 'text', delta: 'ok2' }])
      await collect(
        service.stream(
          baseStreamArgs({
            userMessage: 'first-text',
            clientMessageId: 'dupe-1',
          }),
        ),
      )

      const persisted = store.getPersistedMessages(CONVERSATION_ID)
      const userRows = persisted.filter((m) => m.role === ChatMessageRole.user)
      expect(userRows).toHaveLength(1)
    })
  })

  describe('tool calls', () => {
    it('forwards tool_call and tool_result chunks alongside text', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([
        { kind: 'text', delta: 'before ' },
        {
          kind: 'toolCall',
          name: 'web_search',
          input: { q: 'goodparty' },
          output: { results: ['r1'] },
        },
        { kind: 'text', delta: 'after' },
      ])

      const chunks = await collect(
        service.stream(baseStreamArgs({ tools: { web_search: fakeTool } })),
      )

      const meaningful = chunks.filter((c) => c.type !== 'done')
      expect(meaningful).toEqual([
        { type: 'text', delta: 'before ' },
        {
          type: 'tool_call',
          toolName: 'web_search',
          args: { q: 'goodparty' },
        },
        {
          type: 'tool_result',
          toolName: 'web_search',
          result: { results: ['r1'] },
        },
        { type: 'text', delta: 'after' },
      ])
    })

    it('forwards tool_input_start before tool_call, and does not persist it', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([
        { kind: 'toolInputStart', toolName: 'web_search' },
        {
          kind: 'toolCall',
          name: 'web_search',
          input: { q: 'goodparty' },
          output: { results: ['r1'] },
        },
        { kind: 'text', delta: 'done' },
      ])

      const chunks = await collect(
        service.stream(baseStreamArgs({ tools: { web_search: fakeTool } })),
      )

      const meaningful = chunks.filter((c) => c.type !== 'done')
      expect(meaningful).toEqual([
        { type: 'tool_input_start', toolName: 'web_search' },
        {
          type: 'tool_call',
          toolName: 'web_search',
          args: { q: 'goodparty' },
        },
        {
          type: 'tool_result',
          toolName: 'web_search',
          result: { results: ['r1'] },
        },
        { type: 'text', delta: 'done' },
      ])
      // tool_input_start is transient: it is never persisted as a segment.
      expect(store.lastAppendedSegments).toEqual([
        { kind: 'tool', toolName: 'web_search', payload: { q: 'goodparty' } },
        { kind: 'text', text: 'done' },
      ])
    })

    it('persists a clean widget-only turn (tool call, no text) so it replays', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([
        {
          kind: 'toolCall',
          name: 'present_comparables',
          input: { comparables: [{ city: 'Riverton', state: 'WA' }] },
          output: { saved: true },
        },
      ])

      await collect(
        service.stream(
          baseStreamArgs({ tools: { present_comparables: fakeTool } }),
        ),
      )

      const assistantRows = store
        .getPersistedMessages(CONVERSATION_ID)
        .filter((m) => m.role === ChatMessageRole.assistant)
      expect(assistantRows).toHaveLength(1)
      // Not the interrupted sentinel — this was a clean finish, and the tool
      // segment must persist so the widget replays on reload.
      expect(assistantRows[0]?.content).not.toBe(
        CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER,
      )
      expect(store.lastAppendedSegments).toEqual([
        {
          kind: 'tool',
          toolName: 'present_comparables',
          payload: { comparables: [{ city: 'Riverton', state: 'WA' }] },
        },
      ])
    })

    it('assembles ordered text/tool segments and persists them', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([
        { kind: 'text', delta: 'before ' },
        {
          kind: 'toolCall',
          name: 'web_search',
          input: { q: 'goodparty' },
          output: { results: ['r1'] },
        },
        { kind: 'text', delta: 'after' },
      ])

      await collect(
        service.stream(baseStreamArgs({ tools: { web_search: fakeTool } })),
      )

      expect(store.lastAppendedSegments).toEqual([
        { kind: 'text', text: 'before ' },
        { kind: 'tool', toolName: 'web_search', payload: { q: 'goodparty' } },
        { kind: 'text', text: 'after' },
      ])
    })

    it('persists no segments for a pure-text turn', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'just text' }])

      await collect(service.stream(baseStreamArgs()))

      expect(store.lastAppendedSegments).toBeUndefined()
    })
  })

  describe('abort', () => {
    it('emits only pre-abort text, persists partial, and yields done', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      const controller = new AbortController()
      let releaseGate: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve
      })
      llm.setScript([
        { kind: 'text', delta: 'partial ' },
        { kind: 'gate', gate },
        { kind: 'text', delta: 'more' },
      ])

      const iter = service.stream(baseStreamArgs({ signal: controller.signal }))
      const reader = iter[Symbol.asyncIterator]()

      const rest: ChatStreamChunk[] = []
      const first = await reader.next()
      if (!first.done && first.value) rest.push(first.value)

      controller.abort()
      releaseGate()

      while (true) {
        const r = await reader.next()
        if (r.done) break
        rest.push(r.value)
      }

      const texts = rest.filter((c) => c.type === 'text')
      expect(texts).toEqual([{ type: 'text', delta: 'partial ' }])

      const persisted = store.getPersistedMessages(CONVERSATION_ID)
      const assistantRow = persisted.find(
        (m) => m.role === ChatMessageRole.assistant,
      )
      expect(assistantRow?.content).toBe('partial ')

      const done = rest.find((c) => c.type === 'done')
      expect(done?.type).toBe('done')
    })

    it('forwards the abort signal to llm service', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      const controller = new AbortController()
      llm.setScript([{ kind: 'text', delta: 'hi' }])

      await collect(
        service.stream(baseStreamArgs({ signal: controller.signal })),
      )

      expect(llm.calls[0]?.options.abortSignal).toBe(controller.signal)
    })
  })

  describe('error path — sanitization', () => {
    it('yields rate_limited with retryable=true and generic message for 429', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      const err = Object.assign(
        new Error('429 Too Many Requests from upstream'),
        { status: 429 },
      )
      llm.setConnectError(err)

      const chunks = await collect(service.stream(baseStreamArgs()))

      const errorChunk = expectErrorChunk(chunks)
      expect(errorChunk.code).toBe('rate_limited')
      expect(errorChunk.retryable).toBe(true)
      expect(errorChunk.message).not.toContain('429 Too Many Requests')
      expect(errorChunk.message).not.toContain('upstream')
      expect(errorChunk.message.toLowerCase()).toContain('rate')
    })

    it('yields upstream_unavailable for 5xx with retryable=true and sanitized message', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      const err = Object.assign(
        new Error('500 Internal Server Error: Tavily failed at /v1/search'),
        { status: 503 },
      )
      llm.setConnectError(err)

      const chunks = await collect(service.stream(baseStreamArgs()))

      const errorChunk = expectErrorChunk(chunks)
      expect(errorChunk.code).toBe('upstream_unavailable')
      expect(errorChunk.retryable).toBe(true)
      expect(errorChunk.message).not.toContain('Tavily')
      expect(errorChunk.message).not.toContain('/v1/search')
    })

    it('yields internal for unknown errors with retryable=false and sanitized message', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setConnectError(
        new Error(
          'AI_APICallError model=anthropic/claude-sonnet-4 endpoint=https://api.anthropic.com',
        ),
      )

      const chunks = await collect(service.stream(baseStreamArgs()))

      const errorChunk = expectErrorChunk(chunks)
      expect(errorChunk.code).toBe('internal')
      expect(errorChunk.retryable).toBe(false)
      expect(errorChunk.message).not.toContain('anthropic')
      expect(errorChunk.message).not.toContain('claude-sonnet')
      expect(errorChunk.message).not.toContain('api.anthropic.com')
    })

    it('yields aborted code when error is an AbortError', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      const abortErr = Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      })
      llm.setConnectError(abortErr)

      const chunks = await collect(service.stream(baseStreamArgs()))

      const errorChunk = expectErrorChunk(chunks)
      expect(errorChunk.code).toBe('aborted')
      expect(errorChunk.retryable).toBe(false)
    })

    it('surfaces a mid-stream error delivered via onStreamError (SDK does not throw)', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      // The AI SDK routes provider errors to onError and ends textStream
      // normally (no throw), so the error must be surfaced via onStreamError —
      // otherwise the turn would look clean and the client would get no error.
      llm.setScript([
        { kind: 'text', delta: 'partial ' },
        {
          kind: 'streamError',
          error: Object.assign(
            new Error('AI_APICallError: 500 https://api.anthropic.com'),
            { status: 500 },
          ),
        },
      ])

      const chunks = await collect(service.stream(baseStreamArgs()))

      const errorChunk = expectErrorChunk(chunks)
      expect(errorChunk.code).toBe('upstream_unavailable')
      expect(errorChunk.message).not.toContain('api.anthropic.com')
      // The partial text is persisted; the turn is not falsely marked clean.
      const assistantRow = store
        .getPersistedMessages(CONVERSATION_ID)
        .find((m) => m.role === ChatMessageRole.assistant)
      expect(assistantRow?.content).toBe('partial ')
    })

    it('persists partial text and yields sanitized error when llm throws mid-stream', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([
        { kind: 'text', delta: 'partial ' },
        {
          kind: 'error',
          error: Object.assign(
            new Error(
              'AI_APICallError: 500 https://api.together.xyz model=meta-llama',
            ),
            { status: 500 },
          ),
        },
      ])

      const chunks = await collect(service.stream(baseStreamArgs()))

      const errorChunk = expectErrorChunk(chunks)
      expect(errorChunk.code).toBe('upstream_unavailable')
      expect(errorChunk.message).not.toContain('api.together.xyz')
      expect(errorChunk.message).not.toContain('meta-llama')

      const persisted = store.getPersistedMessages(CONVERSATION_ID)
      const assistantRow = persisted.find(
        (m) => m.role === ChatMessageRole.assistant,
      )
      expect(assistantRow?.content).toBe('partial ')
    })
  })

  describe('mid-stream consumer return (client disconnect)', () => {
    it('persists partial assistant text when consumer returns the iterator early', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      let releaseGate: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve
      })
      llm.setScript([
        { kind: 'text', delta: 'hel' },
        { kind: 'text', delta: 'lo ' },
        { kind: 'gate', gate },
        { kind: 'text', delta: 'world' },
      ])

      const iter = service.stream(baseStreamArgs())
      const reader = iter[Symbol.asyncIterator]()

      const first = await reader.next()
      const second = await reader.next()
      expect(first.value).toEqual({ type: 'text', delta: 'hel' })
      expect(second.value).toEqual({ type: 'text', delta: 'lo ' })

      const returned = reader.return?.()
      releaseGate()
      if (returned) await returned

      const persisted = store.getPersistedMessages(CONVERSATION_ID)
      const assistantRow = persisted.find(
        (m) => m.role === ChatMessageRole.assistant,
      )
      expect(assistantRow).toBeDefined()
      expect(assistantRow?.content).toBe('hello ')
    })

    it('persists the finished turn even when the consumer stops reading mid-stream (SSE backpressure)', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([
        { kind: 'text', delta: 'Peer cities: ' },
        {
          kind: 'toolCall',
          name: 'present_comparables',
          input: { comparables: [{ city: 'Yellow Springs', state: 'OH' }] },
          output: { saved: true },
        },
      ])

      const iter = service.stream(
        baseStreamArgs({ tools: { present_comparables: fakeTool } }),
      )
      const reader = iter[Symbol.asyncIterator]()

      // Pull only the first chunk, then stop pulling entirely — no further
      // next(), no return(). Models an SSE client parked on write backpressure
      // (reply.raw.write() returned false, the 'drain' event never fires). The
      // model stream still finishes server-side, so the assistant turn MUST
      // persist regardless of whether the client keeps draining.
      const first = await reader.next()
      expect(first.done).toBe(false)

      await waitForCondition(() =>
        store
          .getPersistedMessages(CONVERSATION_ID)
          .some((m) => m.role === ChatMessageRole.assistant),
      )

      const assistantRows = store
        .getPersistedMessages(CONVERSATION_ID)
        .filter((m) => m.role === ChatMessageRole.assistant)
      expect(assistantRows).toHaveLength(1)
      expect(assistantRows[0]?.content).toBe('Peer cities: ')
      expect(store.lastAppendedSegments).toEqual([
        { kind: 'text', text: 'Peer cities: ' },
        {
          kind: 'tool',
          toolName: 'present_comparables',
          payload: { comparables: [{ city: 'Yellow Springs', state: 'OH' }] },
        },
      ])

      reader.return?.()
    })

    it('writes the interrupted sentinel when aborted before any text even if the client stops reading', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      const controller = new AbortController()
      let releaseGate: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve
      })
      llm.setScript([
        {
          kind: 'toolCall',
          name: 'present_comparables',
          input: { comparables: [{ city: 'Riverton', state: 'WA' }] },
          output: { saved: true },
        },
        { kind: 'gate', gate },
        { kind: 'text', delta: 'unreached' },
      ])

      const iter = service.stream(
        baseStreamArgs({
          signal: controller.signal,
          tools: { present_comparables: fakeTool },
        }),
      )
      const reader = iter[Symbol.asyncIterator]()
      // Pull the tool_call + tool_result, then the client disconnects (abort)
      // WITHOUT draining to done and WITHOUT return()ing the iterator — models
      // an SSE consumer that stops reading mid-tool-call. The generator parks at
      // yield so the `finally` never runs; only driveStream's decoupled persist
      // fires. It must leave exactly one sentinel row, never zero (regression:
      // a finally/driveStream race could drop the sentinel entirely).
      await reader.next()
      await reader.next()
      controller.abort()
      releaseGate()

      await waitForCondition(() =>
        store
          .getPersistedMessages(CONVERSATION_ID)
          .some((m) => m.role === ChatMessageRole.assistant),
      )
      const rows = store
        .getPersistedMessages(CONVERSATION_ID)
        .filter((m) => m.role === ChatMessageRole.assistant)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.content).toBe(CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER)
      // The sentinel carries no tool segments (no orphaned widget pill).
      expect(store.lastAppendedSegments).toBeUndefined()

      reader.return?.()
    })

    it('persists nothing (no spurious sentinel) on a clean finish with no content', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      // A clean finish (finishReason stop, no abort, no error) that emitted only
      // an empty delta and no tool call: there is nothing to show and it was not
      // interrupted, so it must NOT be marked with the retry sentinel.
      llm.setScript([{ kind: 'text', delta: '' }])

      await collect(service.stream(baseStreamArgs()))

      const assistantRows = store
        .getPersistedMessages(CONVERSATION_ID)
        .filter((m) => m.role === ChatMessageRole.assistant)
      expect(assistantRows).toHaveLength(0)
    })

    it('writes no spurious sentinel when the consumer returns right after the done chunk (clean-empty)', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      // Clean-empty turn. The consumer reads through the done chunk then returns
      // the iterator (models a `for await` that breaks on type === 'done'): the
      // generator jumps to finally without resuming past the yield, so the
      // completedNormally signal must already be set — otherwise the finally
      // writes a spurious retry sentinel on a successful turn.
      llm.setScript([{ kind: 'text', delta: '' }])

      const iter = service.stream(baseStreamArgs())
      const reader = iter[Symbol.asyncIterator]()
      while (true) {
        const r = await reader.next()
        if (r.done || r.value.type === 'done') break
      }
      await reader.return?.()

      const assistantRows = store
        .getPersistedMessages(CONVERSATION_ID)
        .filter((m) => m.role === ChatMessageRole.assistant)
      expect(assistantRows).toHaveLength(0)
    })

    it('does not double-persist when the stream completes normally', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([
        { kind: 'text', delta: 'one ' },
        { kind: 'text', delta: 'two' },
      ])

      await collect(service.stream(baseStreamArgs()))

      const persisted = store.getPersistedMessages(CONVERSATION_ID)
      const assistantRows = persisted.filter(
        (m) => m.role === ChatMessageRole.assistant,
      )
      expect(assistantRows).toHaveLength(1)
      expect(assistantRows[0]?.content).toBe('one two')
    })
  })

  describe('braintrust tracing', () => {
    it('does not throw when BraintrustService is not provided', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'ok' }])

      await expect(
        collect(service.stream(baseStreamArgs())),
      ).resolves.toBeDefined()
    })

    const buildTracedService = (traced: ReturnType<typeof vi.fn>) => {
      const braintrust = {
        enabled: true,
        traced,
      } as unknown as BraintrustService
      return new ChatStreamService(
        store.asService(),
        llm as unknown as LlmService,
        createMockLogger(),
        braintrust,
      )
    }

    it('wraps stream with traced() using the caller-supplied name and expected input/metadata', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'hello' }])
      const traced = vi.fn(
        async (
          _name: string,
          fn: () => unknown,
          _opts?: Record<string, unknown>,
        ) => fn(),
      )
      const tracedService = buildTracedService(traced)

      await collect(
        tracedService.stream({
          ...baseStreamArgs({ userMessage: 'hi there' }),
          traceName: 'ordinance_flow-chat-stream',
        }),
      )

      expect(traced).toHaveBeenCalledTimes(1)
      const [name, fn, opts] = firstOrThrow(traced.mock.calls)
      // The shared service must not hardcode a scope's name; it uses whatever
      // the caller passed (each scope supplies its own).
      expect(name).toBe('ordinance_flow-chat-stream')
      expect(typeof fn).toBe('function')
      expect(opts).toMatchObject({
        input: expect.objectContaining({
          conversationId: CONVERSATION_ID,
          userMessageLength: 'hi there'.length,
        }),
        metadata: expect.objectContaining({
          ownerUserId: OWNER_ID,
        }),
      })
    })

    it('falls back to a generic trace name when the caller supplies none', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'hello' }])
      const traced = vi.fn(async (_name: string, fn: () => unknown) => fn())
      const tracedService = buildTracedService(traced)

      await collect(tracedService.stream(baseStreamArgs({ userMessage: 'x' })))

      const [name] = firstOrThrow(traced.mock.calls)
      expect(name).toBe('chat-stream')
    })

    it('passes stream metrics (textLength, toolCallCount) as the traced function return value', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([
        { kind: 'text', delta: 'abcd' },
        {
          kind: 'toolCall',
          name: 'web_search',
          input: { q: 'x' },
          output: { results: [] },
        },
        { kind: 'text', delta: 'ef' },
      ])
      let capturedReturn: unknown
      const traced = vi.fn(
        async (
          _name: string,
          fn: () => unknown,
          _opts?: Record<string, unknown>,
        ) => {
          capturedReturn = await fn()
          return capturedReturn
        },
      )
      const braintrust = {
        enabled: true,
        traced,
      } as unknown as BraintrustService
      const tracedService = new ChatStreamService(
        store.asService(),
        llm as unknown as LlmService,
        createMockLogger(),
        braintrust,
      )

      await collect(
        tracedService.stream(
          baseStreamArgs({ tools: { web_search: fakeTool } }),
        ),
      )

      expect(capturedReturn).toMatchObject({
        textLength: 'abcdef'.length,
        toolCallCount: 1,
      })
    })

    it('records errorCode in traced metrics when stream errors mid-flight', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([
        { kind: 'text', delta: 'partial ' },
        {
          kind: 'error',
          error: Object.assign(new Error('500 boom'), { status: 500 }),
        },
      ])
      let capturedReturn: unknown
      const traced = vi.fn(
        async (
          _name: string,
          fn: () => unknown,
          _opts?: Record<string, unknown>,
        ) => {
          capturedReturn = await fn()
          return capturedReturn
        },
      )
      const braintrust = {
        enabled: true,
        traced,
      } as unknown as BraintrustService
      const tracedService = new ChatStreamService(
        store.asService(),
        llm as unknown as LlmService,
        createMockLogger(),
        braintrust,
      )

      await collect(tracedService.stream(baseStreamArgs()))

      expect(capturedReturn).toMatchObject({
        errorCode: 'upstream_unavailable',
        textLength: 'partial '.length,
      })
    })
  })

  describe('forwarding', () => {
    it('forwards tools verbatim to llm service', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'ok' }])
      const tools = { search: fakeTool, other: fakeTool }

      await collect(service.stream(baseStreamArgs({ tools })))

      expect(llm.calls[0]?.options.tools).toBe(tools)
    })

    it('forwards maxSteps to llm when set', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'ok' }])

      await collect(service.stream(baseStreamArgs({ maxSteps: 8 })))

      expect(firstOrThrow(llm.calls).options.maxSteps).toBe(8)
    })

    it('omits maxSteps from the llm call when not set', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'ok' }])

      await collect(service.stream(baseStreamArgs()))

      expect(firstOrThrow(llm.calls).options).not.toHaveProperty('maxSteps')
    })

    it('forwards systemPrompt verbatim as first system message', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      llm.setScript([{ kind: 'text', delta: 'ok' }])

      const args = baseStreamArgs()
      args.systemPrompt = 'YOU ARE TEST PROMPT'
      await collect(service.stream(args))

      const sent = firstOrThrow(llm.calls).options.messages
      const first = firstOrThrow(sent)
      expect(first.role).toBe('system')
      expect(first.content).toBe('YOU ARE TEST PROMPT')
    })
  })

  describe('empty-buffer sentinel (tool-only response)', () => {
    it('persists CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER when a turn is interrupted before any text', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      const abortErr = Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      })
      // A tool call, then an interrupt before any text is emitted: this is NOT
      // a clean widget-only turn, so it gets the sentinel (retry affordance)
      // with no orphaned tool segments — not the persisted widget.
      llm.setScript([
        {
          kind: 'toolCall',
          name: 'web_search',
          input: { q: 'x' },
          output: { results: [] },
        },
        { kind: 'error', error: abortErr },
      ])

      await collect(
        service.stream(baseStreamArgs({ tools: { web_search: fakeTool } })),
      )

      const persisted = store.getPersistedMessages(CONVERSATION_ID)
      const assistantRows = persisted.filter(
        (m) => m.role === ChatMessageRole.assistant,
      )
      expect(assistantRows).toHaveLength(1)
      expect(assistantRows[0]?.content).toBe(
        CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER,
      )
      // The fake never populates a `segments` field on the row, so asserting
      // on `row.segments` is vacuous. Assert on the args the store received:
      // the sentinel append must pass no segments (no orphaned widget pill).
      expect(store.lastAppendedSegments).toBeUndefined()
    })

    it('writes the sentinel (no widget) when the user aborts after a tool call, before any text', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      const controller = new AbortController()
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      // A real user-cancel (signal.aborted) mid-tool-call with no text is NOT a
      // clean widget-only turn: the widget must be dropped and the sentinel
      // written, so `cleanFinish` must stay false via the `!signal.aborted`
      // clause even though no error is thrown.
      llm.setScript([
        {
          kind: 'toolCall',
          name: 'present_comparables',
          input: { comparables: [{ city: 'Riverton', state: 'WA' }] },
          output: { saved: true },
        },
        { kind: 'gate', gate },
        { kind: 'text', delta: 'unreached' },
      ])

      const iter = service.stream(
        baseStreamArgs({
          signal: controller.signal,
          tools: { present_comparables: fakeTool },
        }),
      )
      const reader = iter[Symbol.asyncIterator]()
      await reader.next()
      controller.abort()
      release()
      while (!(await reader.next()).done) {
        // drain
      }

      const assistantRows = store
        .getPersistedMessages(CONVERSATION_ID)
        .filter((m) => m.role === ChatMessageRole.assistant)
      expect(assistantRows).toHaveLength(1)
      expect(assistantRows[0]?.content).toBe(
        CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER,
      )
      expect(store.lastAppendedSegments).toBeUndefined()
    })
  })

  describe('error logging on mid-stream provider failure', () => {
    it('logs the original error when textStream iteration throws', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      const providerErr = Object.assign(
        new Error('AI_APICallError: 500 internal'),
        { status: 500 },
      )
      llm.setScript([
        { kind: 'text', delta: 'partial ' },
        { kind: 'error', error: providerErr },
      ])
      const logger = createMockLogger()
      const tracedService = new ChatStreamService(
        store.asService(),
        llm as unknown as LlmService,
        logger,
      )

      await collect(tracedService.stream(baseStreamArgs()))

      const errorCalls = (
        logger.error as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls
      const matched = errorCalls.find((args) => {
        const ctx = args[0] as { err?: unknown; conversationId?: string }
        return ctx?.err === providerErr
      })
      expect(matched).toBeDefined()
    })
  })

  describe('queue abort propagation', () => {
    it('wakes the producer awaiting drain when the signal aborts and the consumer has stopped reading', async () => {
      store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
      const controller = new AbortController()
      const overflow = MAX_BUFFERED_CHUNKS * 4
      const script: StreamScriptItem[] = []
      for (let i = 0; i < overflow; i++) {
        script.push({ kind: 'text', delta: `d${i}` })
      }
      llm.setScript(script)

      const producerDone = vi.fn()
      const origStream = llm.streamChatCompletion.bind(llm)
      llm.streamChatCompletion = async (opts: LlmStreamOptions) => {
        const result = await origStream(opts)
        const originalIter = result.textStream
        const wrapped: AsyncIterable<string> = {
          [Symbol.asyncIterator]: async function* () {
            try {
              for await (const v of originalIter) yield v
            } finally {
              producerDone()
            }
          },
        }
        return { ...result, textStream: wrapped }
      }

      const iter = service.stream(baseStreamArgs({ signal: controller.signal }))
      const reader = iter[Symbol.asyncIterator]()

      const first = await reader.next()
      expect(first.done).toBe(false)

      await new Promise<void>((resolve) => setTimeout(resolve, 50))

      controller.abort()

      const settled = await Promise.race([
        (async () => {
          while (!producerDone.mock.calls.length) {
            await new Promise<void>((r) => setTimeout(r, 5))
          }
          return 'done' as const
        })(),
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), 1500),
        ),
      ])

      reader.return?.()

      expect(settled).toBe('done')
    })
  })

  describe('heartbeat', () => {
    it('emits ping chunks while the model is silent mid-generation', async () => {
      vi.useFakeTimers()
      try {
        store.seedConversation({ id: CONVERSATION_ID, ownerUserId: OWNER_ID })
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        llm.streamChatCompletion = (
          options: LlmStreamOptions,
        ): Promise<LlmStreamResult> => {
          const textStream: AsyncIterable<string> = {
            [Symbol.asyncIterator]: async function* () {
              if (options.abortSignal?.aborted) return
              await gate
              yield 'draft ready'
            },
          }
          return Promise.resolve({
            textStream,
            finalText: Promise.resolve('draft ready'),
            toolCalls: Promise.resolve([]),
            usage: Promise.resolve({
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            }),
            model: 'fake-model-x',
          })
        }

        const chunks: ChatStreamChunk[] = []
        const consumed = (async () => {
          for await (const chunk of service.stream(baseStreamArgs())) {
            chunks.push(chunk)
          }
        })()

        // Let the generator run its (promise-based) setup so the heartbeat
        // interval is registered before the clock advances.
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(45_000)
        expect(
          chunks.filter((c) => c.type === 'ping').length,
        ).toBeGreaterThanOrEqual(2)

        release()
        await vi.advanceTimersByTimeAsync(0)
        await consumed

        expect(
          chunks.some((c) => c.type === 'text' && c.delta === 'draft ready'),
        ).toBe(true)
        expect(chunks[chunks.length - 1]?.type).toBe('done')
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMessageRole, ChatScope } from '../../../generated/prisma'
import type { ChatStreamChunk } from '@/chats/services/chatStream.service'
import type { ChatStoreService } from '@/chats/services/chatStore.prisma'
import { GeneralChatsService } from './general-chats.service'
import { ChatScopeRegistry } from './chatScopeRegistry.service'
import { GeneralChatStoreService } from './generalChatStore.prisma'
import { ChatScopeHandler } from '../types/chatScopeHandler'

const SCOPE = ChatScope.chief_of_staff
const USER_ID = 7
const ORG = 'eo-123'

const buildHandler = (
  overrides: Partial<ChatScopeHandler> = {},
): ChatScopeHandler =>
  ({
    scope: SCOPE,
    isSensitive: true,
    models: ['claude-sonnet-4-6'],
    resolveConversation: vi.fn(() =>
      Promise.resolve({ conversationId: 'conv-new', created: true }),
    ),
    loadContext: vi.fn(() => Promise.resolve({})),
    buildSystemPrompt: vi.fn(() => 'system'),
    buildTools: vi.fn(() => ({})),
    ...overrides,
  }) as unknown as ChatScopeHandler

const buildRegistry = (handler: ChatScopeHandler): ChatScopeRegistry =>
  ({
    has: (s: ChatScope) => s === handler.scope,
    get: (s: ChatScope) => (s === handler.scope ? handler : undefined),
  }) as unknown as ChatScopeRegistry

const buildStore = (
  overrides: Partial<GeneralChatStoreService> = {},
): GeneralChatStoreService =>
  ({
    createScopedConversation: vi.fn(),
    listByScope: vi.fn(() => Promise.resolve([])),
    findOwnedConversation: vi.fn(),
    setTitleIfUnset: vi.fn(() => Promise.resolve()),
    ...overrides,
  }) as unknown as GeneralChatStoreService

const buildChatStore = (
  overrides: Partial<ChatStoreService> = {},
): ChatStoreService =>
  ({
    appendUserMessageIfAlive: vi.fn(() =>
      Promise.resolve({ id: 'user-msg-1' }),
    ),
    appendMessage: vi.fn(() => Promise.resolve({ id: 'assistant-msg-1' })),
    ...overrides,
  }) as unknown as ChatStoreService

const collect = async (
  iterable: AsyncIterable<ChatStreamChunk>,
): Promise<ChatStreamChunk[]> => {
  const out: ChatStreamChunk[] = []
  for await (const c of iterable) out.push(c)
  return out
}

describe('GeneralChatsService', () => {
  let handler: ChatScopeHandler
  let store: GeneralChatStoreService

  beforeEach(() => {
    handler = buildHandler()
    store = buildStore()
  })

  it('routes resolveConversation to the scope handler', async () => {
    const service = new GeneralChatsService(
      buildRegistry(handler),
      store,
      {} as never,
      {} as never,
    )
    const result = await service.resolveConversation(
      { scope: SCOPE, organizationSlug: ORG },
      USER_ID,
    )
    expect(result).toEqual({ conversationId: 'conv-new', created: true })
    expect(handler.resolveConversation).toHaveBeenCalledWith(
      { scope: SCOPE, organizationSlug: ORG },
      USER_ID,
    )
  })

  it('rejects an unregistered scope', async () => {
    const service = new GeneralChatsService(
      buildRegistry(handler),
      store,
      {} as never,
      {} as never,
    )
    expect(() =>
      service.resolveConversation(
        { scope: ChatScope.campaign_assistant, organizationSlug: ORG },
        USER_ID,
      ),
    ).toThrowError(NotFoundException)
  })

  it('lists scoped conversations with titles', async () => {
    const now = new Date('2026-06-15T00:00:00Z')
    store = buildStore({
      listByScope: vi.fn(() =>
        Promise.resolve([
          {
            id: 'c1',
            title: 'My first question',
            createdAt: now,
            updatedAt: now,
          },
        ]),
      ) as never,
    })
    const service = new GeneralChatsService(
      buildRegistry(handler),
      store,
      {} as never,
      {} as never,
    )
    const list = await service.listConversations({
      scope: SCOPE,
      userId: USER_ID,
      organizationSlug: ORG,
    })
    expect(list).toEqual([
      {
        conversationId: 'c1',
        title: 'My first question',
        createdAt: now,
        updatedAt: now,
      },
    ])
  })

  it('soft-deletes an owned conversation via the shared store', async () => {
    const softDelete = vi.fn(() => Promise.resolve())
    store = buildStore({
      findOwnedConversation: vi.fn(() =>
        Promise.resolve({ id: 'c1', title: null }),
      ) as never,
    })
    const service = new GeneralChatsService(
      buildRegistry(handler),
      store,
      { softDeleteConversation: softDelete } as never,
      {} as never,
    )
    await service.deleteConversation('c1', SCOPE, USER_ID, ORG)
    expect(softDelete).toHaveBeenCalledWith('c1', USER_ID)
  })

  it('404s deleting a conversation the user does not own', async () => {
    store = buildStore({
      findOwnedConversation: vi.fn(() => Promise.resolve(null)) as never,
    })
    const service = new GeneralChatsService(
      buildRegistry(handler),
      store,
      {} as never,
      {} as never,
    )
    await expect(
      service.deleteConversation('c1', SCOPE, USER_ID, ORG),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it(
    'streams with the handler prompt + tools + claude-only models, ' +
      'and titles from the first message',
    async () => {
      store = buildStore({
        findOwnedConversation: vi.fn(() =>
          Promise.resolve({ id: 'c1', title: null }),
        ) as never,
      })
      const streamArgs: { value?: unknown } = {}
      const chatStream = {
        stream: vi.fn((args: unknown) => {
          streamArgs.value = args
          return {
            [Symbol.asyncIterator]: async function* () {
              yield { type: 'text', delta: 'hi' } as ChatStreamChunk
              yield { type: 'done' } as ChatStreamChunk
            },
          }
        }),
      }
      const service = new GeneralChatsService(
        buildRegistry(handler),
        store,
        {} as never,
        chatStream as never,
      )
      const chunks = await collect(
        service.sendMessage({
          conversationId: 'c1',
          scope: SCOPE,
          userId: USER_ID,
          organizationSlug: ORG,
          userMessage: 'What should I do about the housing vote?',
        }),
      )
      expect(chunks.map((c) => c.type)).toEqual(['text', 'done'])
      expect(store.setTitleIfUnset).toHaveBeenCalledWith(
        'c1',
        'What should I do about the housing vote?',
      )
      expect(handler.buildSystemPrompt).toHaveBeenCalled()
      expect(handler.buildTools).toHaveBeenCalled()
      expect(streamArgs.value).toMatchObject({
        conversationId: 'c1',
        systemPrompt: 'system',
        models: ['claude-sonnet-4-6'],
      })
    },
  )

  it('passes handler.maxSteps through to the chat stream', async () => {
    handler = buildHandler({ maxSteps: 8 })
    store = buildStore({
      findOwnedConversation: vi.fn(() =>
        Promise.resolve({ id: 'c1', title: 'existing' }),
      ) as never,
    })
    const streamArgs: { value?: unknown } = {}
    const chatStream = {
      stream: vi.fn((args: unknown) => {
        streamArgs.value = args
        return {
          [Symbol.asyncIterator]: async function* () {
            yield { type: 'done' } as ChatStreamChunk
          },
        }
      }),
    }
    const service = new GeneralChatsService(
      buildRegistry(handler),
      store,
      {} as never,
      chatStream as never,
    )
    await collect(
      service.sendMessage({
        conversationId: 'c1',
        scope: SCOPE,
        userId: USER_ID,
        organizationSlug: ORG,
        userMessage: 'hi',
      }),
    )
    expect(streamArgs.value).toMatchObject({ maxSteps: 8 })
  })

  it('yields conversation_not_found when streaming a missing conversation', async () => {
    store = buildStore({
      findOwnedConversation: vi.fn(() => Promise.resolve(null)) as never,
    })
    const service = new GeneralChatsService(
      buildRegistry(handler),
      store,
      {} as never,
      {} as never,
    )
    const chunks = await collect(
      service.sendMessage({
        conversationId: 'missing',
        scope: SCOPE,
        userId: USER_ID,
        organizationSlug: ORG,
        userMessage: 'hi',
      }),
    )
    expect(chunks).toEqual([
      {
        type: 'error',
        code: 'conversation_not_found',
        message: 'Conversation not found.',
        retryable: false,
      },
    ])
  })

  it(
    'answers a canned reply from the handler without calling the LLM ' +
      'or auto-titling',
    async () => {
      handler = buildHandler({
        maybeCannedReply: vi.fn((userMessage: string) =>
          userMessage === '__kickoff__' ? 'Welcome aboard!' : null,
        ),
      })
      store = buildStore({
        findOwnedConversation: vi.fn(() =>
          Promise.resolve({ id: 'c1', title: null }),
        ) as never,
      })
      const chatStore = buildChatStore()
      const chatStream = { stream: vi.fn() }
      const service = new GeneralChatsService(
        buildRegistry(handler),
        store,
        chatStore,
        chatStream as never,
      )
      const chunks = await collect(
        service.sendMessage({
          conversationId: 'c1',
          scope: SCOPE,
          userId: USER_ID,
          organizationSlug: ORG,
          userMessage: '__kickoff__',
          clientMessageId: 'client-1',
        }),
      )
      expect(chunks).toEqual([
        { type: 'text', delta: 'Welcome aboard!' },
        { type: 'done', assistantMessageId: 'assistant-msg-1' },
      ])
      // The user (sentinel) turn is persisted first so history alternates,
      // keyed on clientMessageId for dedup...
      expect(chatStore.appendUserMessageIfAlive).toHaveBeenCalledWith({
        conversationId: 'c1',
        ownerUserId: USER_ID,
        content: '__kickoff__',
        clientMessageId: 'client-1',
      })
      // ...then the canned assistant reply, under a derived idempotency key.
      expect(chatStore.appendMessage).toHaveBeenCalledWith({
        conversationId: 'c1',
        role: ChatMessageRole.assistant,
        content: 'Welcome aboard!',
        clientMessageId: 'client-1:assistant',
      })
      expect(chatStream.stream).not.toHaveBeenCalled()
      expect(store.setTitleIfUnset).not.toHaveBeenCalled()
    },
  )

  it(
    'stays idempotent on retry: reuses the same client + derived keys for ' +
      'both turns so neither row is duplicated',
    async () => {
      handler = buildHandler({
        maybeCannedReply: vi.fn((userMessage: string) =>
          userMessage === '__kickoff__' ? 'Welcome aboard!' : null,
        ),
      })
      store = buildStore({
        findOwnedConversation: vi.fn(() =>
          Promise.resolve({ id: 'c1', title: null }),
        ) as never,
      })
      // The store dedups on these keys (see appendMessageIdempotent); the
      // service's job is to send the SAME keys on a retry so no second row is
      // ever created. Assert that contract with a stable-return mock.
      const chatStore = buildChatStore()
      const chatStream = { stream: vi.fn() }
      const service = new GeneralChatsService(
        buildRegistry(handler),
        store,
        chatStore,
        chatStream as never,
      )
      const args = {
        conversationId: 'c1',
        scope: SCOPE,
        userId: USER_ID,
        organizationSlug: ORG,
        userMessage: '__kickoff__',
        clientMessageId: 'client-1',
      }
      await collect(service.sendMessage(args))
      await collect(service.sendMessage(args))

      expect(chatStore.appendUserMessageIfAlive).toHaveBeenCalledTimes(2)
      expect(chatStore.appendUserMessageIfAlive).toHaveBeenNthCalledWith(1, {
        conversationId: 'c1',
        ownerUserId: USER_ID,
        content: '__kickoff__',
        clientMessageId: 'client-1',
      })
      expect(chatStore.appendUserMessageIfAlive).toHaveBeenNthCalledWith(2, {
        conversationId: 'c1',
        ownerUserId: USER_ID,
        content: '__kickoff__',
        clientMessageId: 'client-1',
      })
      expect(chatStore.appendMessage).toHaveBeenCalledTimes(2)
      expect(chatStore.appendMessage).toHaveBeenNthCalledWith(1, {
        conversationId: 'c1',
        role: ChatMessageRole.assistant,
        content: 'Welcome aboard!',
        clientMessageId: 'client-1:assistant',
      })
      expect(chatStore.appendMessage).toHaveBeenNthCalledWith(2, {
        conversationId: 'c1',
        role: ChatMessageRole.assistant,
        content: 'Welcome aboard!',
        clientMessageId: 'client-1:assistant',
      })
    },
  )

  it(
    'errors a canned reply without appending when clientMessageId is ' +
      'absent, to stay idempotent on retry',
    async () => {
      handler = buildHandler({
        maybeCannedReply: vi.fn((userMessage: string) =>
          userMessage === '__kickoff__' ? 'Welcome aboard!' : null,
        ),
      })
      store = buildStore({
        findOwnedConversation: vi.fn(() =>
          Promise.resolve({ id: 'c1', title: null }),
        ) as never,
      })
      const chatStore = buildChatStore()
      const chatStream = { stream: vi.fn() }
      const service = new GeneralChatsService(
        buildRegistry(handler),
        store,
        chatStore,
        chatStream as never,
      )
      const chunks = await collect(
        service.sendMessage({
          conversationId: 'c1',
          scope: SCOPE,
          userId: USER_ID,
          organizationSlug: ORG,
          userMessage: '__kickoff__',
        }),
      )
      expect(chunks).toEqual([
        {
          type: 'error',
          code: 'internal',
          message: 'clientMessageId is required for this request.',
          retryable: false,
        },
      ])
      expect(chatStore.appendUserMessageIfAlive).not.toHaveBeenCalled()
      expect(chatStore.appendMessage).not.toHaveBeenCalled()
      expect(chatStream.stream).not.toHaveBeenCalled()
    },
  )

  it('runs the normal LLM turn when maybeCannedReply returns null', async () => {
    handler = buildHandler({
      maybeCannedReply: vi.fn(() => null),
    })
    store = buildStore({
      findOwnedConversation: vi.fn(() =>
        Promise.resolve({ id: 'c1', title: null }),
      ) as never,
    })
    const chatStore = buildChatStore()
    const chatStream = {
      stream: vi.fn(() => ({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', delta: 'hi' } as ChatStreamChunk
          yield { type: 'done' } as ChatStreamChunk
        },
      })),
    }
    const service = new GeneralChatsService(
      buildRegistry(handler),
      store,
      chatStore,
      chatStream as never,
    )
    const chunks = await collect(
      service.sendMessage({
        conversationId: 'c1',
        scope: SCOPE,
        userId: USER_ID,
        organizationSlug: ORG,
        userMessage: 'a normal question',
      }),
    )
    expect(handler.maybeCannedReply).toHaveBeenCalled()
    expect(chatStream.stream).toHaveBeenCalled()
    expect(chatStore.appendMessage).not.toHaveBeenCalled()
    expect(chunks.map((c) => c.type)).toEqual(['text', 'done'])
    expect(store.setTitleIfUnset).toHaveBeenCalledWith(
      'c1',
      'a normal question',
    )
  })
})

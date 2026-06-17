import { describe, expect, it } from 'vitest'
import { ChatScope } from '../../../generated/prisma'
import { ChatScopeRegistry } from './chatScopeRegistry.service'
import { ChatScopeHandler } from '../types/chatScopeHandler'

const handler = (overrides: Partial<ChatScopeHandler>): ChatScopeHandler =>
  ({
    scope: ChatScope.chief_of_staff,
    isSensitive: true,
    models: ['claude-sonnet-4-6', 'claude-opus-4-7'],
    resolveConversation: () =>
      Promise.resolve({ conversationId: 'c', created: true }),
    loadContext: () => Promise.resolve({}),
    buildSystemPrompt: () => '',
    buildTools: () => ({}),
    ...overrides,
  }) as ChatScopeHandler

describe('ChatScopeRegistry', () => {
  it('registers a sensitive scope with an Anthropic-only chain', () => {
    const registry = new ChatScopeRegistry([handler({})])
    expect(registry.has(ChatScope.chief_of_staff)).toBe(true)
    expect(registry.get(ChatScope.chief_of_staff)?.scope).toBe(
      ChatScope.chief_of_staff,
    )
  })

  it('fails closed when a sensitive scope has a non-claude model', () => {
    expect(
      () =>
        new ChatScopeRegistry([
          handler({ models: ['claude-sonnet-4-6', 'llama-3-70b'] }),
        ]),
    ).toThrowError(/Anthropic-only/)
  })

  it('fails closed when a sensitive scope has an empty model chain', () => {
    expect(() => new ChatScopeRegistry([handler({ models: [] })])).toThrowError(
      /Anthropic-only/,
    )
  })

  it('allows a non-sensitive scope to use a non-claude model', () => {
    const registry = new ChatScopeRegistry([
      handler({
        scope: ChatScope.campaign_assistant,
        isSensitive: false,
        models: ['llama-3-70b'],
      }),
    ])
    expect(registry.has(ChatScope.campaign_assistant)).toBe(true)
  })
})

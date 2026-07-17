import { Injectable, NotFoundException } from '@nestjs/common'
import { ChatMessageRole, ChatScope } from '../../../generated/prisma'
import {
  ChatMessageWithSegments,
  ChatStoreService,
} from '@/chats/services/chatStore.prisma'
import {
  ChatStreamChunk,
  ChatStreamService,
} from '@/chats/services/chatStream.service'
import { ChatScopeRegistry } from './chatScopeRegistry.service'
import { GeneralChatStoreService } from './generalChatStore.prisma'
import {
  ChatScopeHandler,
  ResolveConversationParams,
  ResolveConversationResult,
} from '../types/chatScopeHandler'

const TITLE_MAX_LENGTH = 80

export interface ConversationSummary {
  conversationId: string
  title: string | null
  createdAt: Date
  updatedAt: Date
}

export interface LoadedConversation {
  conversationId: string
  scope: ChatScope
  title: string | null
  messages: ChatMessageWithSegments[]
}

export interface SendMessageArgs {
  conversationId: string
  scope: ChatScope
  userId: number
  organizationSlug: string | null
  userMessage: string
  signal?: AbortSignal
  clientMessageId?: string
}

const toTitle = (message: string): string => {
  const trimmed = message.trim().replace(/\s+/g, ' ')
  return trimmed.length <= TITLE_MAX_LENGTH
    ? trimmed
    : `${trimmed.slice(0, TITLE_MAX_LENGTH - 1)}…`
}

@Injectable()
export class GeneralChatsService {
  constructor(
    private readonly registry: ChatScopeRegistry,
    private readonly store: GeneralChatStoreService,
    private readonly chatStore: ChatStoreService,
    private readonly chatStream: ChatStreamService,
  ) {}

  private requireHandler(scope: ChatScope): ChatScopeHandler {
    const handler = this.registry.get(scope)
    if (!handler) {
      throw new NotFoundException(`Unsupported chat scope "${scope}"`)
    }
    return handler
  }

  resolveConversation(
    params: ResolveConversationParams,
    userId: number,
  ): Promise<ResolveConversationResult> {
    return this.requireHandler(params.scope).resolveConversation(params, userId)
  }

  async listConversations(args: {
    scope: ChatScope
    userId: number
    organizationSlug: string | null
  }): Promise<ConversationSummary[]> {
    this.requireHandler(args.scope)
    const rows = await this.store.listByScope({
      ownerUserId: args.userId,
      organizationSlug: args.organizationSlug,
      scope: args.scope,
    })
    return rows.map((c) => ({
      conversationId: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }))
  }

  async loadConversation(
    conversationId: string,
    scope: ChatScope,
    userId: number,
    organizationSlug: string | null,
  ): Promise<LoadedConversation> {
    this.requireHandler(scope)
    const conversation = await this.store.findOwnedConversation(
      conversationId,
      userId,
      scope,
      organizationSlug,
    )
    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }
    const messages =
      await this.chatStore.listMessagesByConversation(conversationId)
    return {
      conversationId,
      scope,
      title: conversation.title,
      messages,
    }
  }

  async deleteConversation(
    conversationId: string,
    scope: ChatScope,
    userId: number,
    organizationSlug: string | null,
  ): Promise<void> {
    this.requireHandler(scope)
    const conversation = await this.store.findOwnedConversation(
      conversationId,
      userId,
      scope,
      organizationSlug,
    )
    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }
    await this.chatStore.softDeleteConversation(conversationId, userId)
  }

  async assertConversationAccessible(
    conversationId: string,
    scope: ChatScope,
    userId: number,
    organizationSlug: string | null,
  ): Promise<void> {
    this.requireHandler(scope)
    const conversation = await this.store.findOwnedConversation(
      conversationId,
      userId,
      scope,
      organizationSlug,
    )
    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }
  }

  sendMessage(args: SendMessageArgs): AsyncIterable<ChatStreamChunk> {
    const run = async function* (
      self: GeneralChatsService,
    ): AsyncGenerator<ChatStreamChunk, void, void> {
      const handler = self.requireHandler(args.scope)
      const conversation = await self.store.findOwnedConversation(
        args.conversationId,
        args.userId,
        args.scope,
        args.organizationSlug,
      )
      if (!conversation) {
        yield {
          type: 'error',
          code: 'conversation_not_found',
          message: 'Conversation not found.',
          retryable: false,
        }
        return
      }

      const ctx = await handler.loadContext(args.conversationId, args.userId)

      const canned = handler.maybeCannedReply?.(args.userMessage, ctx) ?? null
      if (canned !== null) {
        if (!args.clientMessageId) {
          yield {
            type: 'error',
            code: 'internal',
            message: 'clientMessageId is required for this request.',
            retryable: false,
          }
          return
        }
        // Persist the user (sentinel) turn BEFORE the canned assistant reply
        // so history alternates user/assistant — Anthropic rejects two
        // consecutive assistant turns on the candidate's next real message.
        // The user turn dedups on clientMessageId; the assistant reply carries
        // a derived idempotency key so a retry with the same clientMessageId
        // re-streams the same reply without appending a second assistant row.
        const userTurn = await self.chatStore.appendUserMessageIfAlive({
          conversationId: args.conversationId,
          ownerUserId: args.userId,
          content: args.userMessage,
          clientMessageId: args.clientMessageId,
        })
        if (!userTurn) {
          yield {
            type: 'error',
            code: 'conversation_not_found',
            message: 'Conversation not found.',
            retryable: false,
          }
          return
        }
        const saved = await self.chatStore.appendMessage({
          conversationId: args.conversationId,
          role: ChatMessageRole.assistant,
          content: canned,
          clientMessageId: `${args.clientMessageId}:assistant`,
        })
        yield { type: 'text', delta: canned }
        yield { type: 'done', assistantMessageId: saved.id }
        return
      }

      if (conversation.title === null) {
        await self.store.setTitleIfUnset(
          args.conversationId,
          toTitle(args.userMessage),
        )
      }

      const systemPrompt = handler.buildSystemPrompt(ctx)
      const tools = handler.buildTools(ctx)

      const inner = self.chatStream.stream({
        conversationId: args.conversationId,
        ownerUserId: args.userId,
        systemPrompt,
        tools,
        userMessage: args.userMessage,
        models: handler.models,
        ...(handler.maxSteps && { maxSteps: handler.maxSteps }),
        ...(args.signal && { signal: args.signal }),
        ...(args.clientMessageId && { clientMessageId: args.clientMessageId }),
      })

      for await (const chunk of inner) yield chunk
    }
    return {
      [Symbol.asyncIterator]: () => run(this),
    }
  }
}

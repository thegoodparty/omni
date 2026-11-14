import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { ChatMessage } from '../../../generated/prisma'
import { ChatStoreService } from '@/chats/services/chatStore.prisma'
import type { ChatStreamChunk } from '@/chats/services/chatStream.service'
import { CHAT_AGENTS } from '@/agents/agents.registry'
import { LangGraphChatService } from '@/agents/langgraph/langGraphChat.service'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { PeopleDatasetService } from '@/peopleDb/services/peopleDataset.service'
import {
  type ChatScopeHandler,
  hasFinalizeAssistantText,
} from '@/chats/general/types/chatScopeHandler'
import {
  BriefingAnnotationHandler,
  requireConversationId,
} from '../briefingAnnotation.handler'
import type { BriefingChatContext } from '../briefingAnnotation.handler'
import { BriefingContextService } from './briefingContext.service'
import { BriefingNotesService } from './briefingNotes.service'
import { DistrictResolverService } from './districtResolver.service'

export const BRIEFING_CHATS_DATABRICKS_PROVIDER =
  'BRIEFING_CHATS_DATABRICKS_PROVIDER'

export interface SendMessageArgs {
  annotationId: string
  userId: number
  userMessage: string
  signal?: AbortSignal
  clientMessageId?: string
}

export interface LoadConversationResult {
  conversationId: string
  messages: ChatMessage[]
}

@Injectable()
export class BriefingChatsService {
  // The one BriefingAnnotationHandler instance. briefing-chats.module
  // republishes it so the scope registry shares it with this send path.
  readonly handler: BriefingAnnotationHandler

  constructor(
    private readonly briefingContext: BriefingContextService,
    private readonly chatStore: ChatStoreService,
    private readonly langGraphChat: LangGraphChatService,
    notesService: BriefingNotesService,
    @Optional()
    @Inject(BRIEFING_CHATS_DATABRICKS_PROVIDER)
    databricks?: DatabricksProvider,
    @Optional()
    districtResolver?: DistrictResolverService,
    @Optional()
    peopleDatasets?: PeopleDatasetService,
  ) {
    this.handler = new BriefingAnnotationHandler(
      briefingContext,
      notesService,
      databricks,
      districtResolver,
      peopleDatasets,
    )
  }

  // The turn runs on the agent engine (LangGraph), on the conversation's
  // own thread, through the registry's briefingChat agent. Context is
  // loaded here only for the guardrail backstops; the agent loads its own.
  sendMessage(args: SendMessageArgs): AsyncIterable<ChatStreamChunk> {
    const run = async function* (
      self: BriefingChatsService,
    ): AsyncGenerator<ChatStreamChunk, void, void> {
      const ctx = await self.handler.loadContextForAnnotation(
        args.annotationId,
        args.userId,
      )
      const scopeHandler: ChatScopeHandler<BriefingChatContext> = self.handler
      const finalizing = hasFinalizeAssistantText(scopeHandler)
        ? scopeHandler
        : null
      yield* self.langGraphChat.stream({
        agentName: 'briefingChat',
        agent: CHAT_AGENTS.briefingChat,
        conversationId: ctx.conversationId,
        ownerUserId: args.userId,
        organizationSlug: ctx.organizationSlug,
        userMessage: args.userMessage,
        ...(args.signal && { signal: args.signal }),
        ...(args.clientMessageId && { clientMessageId: args.clientMessageId }),
        ...(finalizing && {
          finalizeText: (text, turn) =>
            finalizing.finalizeAssistantText(text, turn, ctx),
        }),
      })
    }
    return {
      [Symbol.asyncIterator]: () => run(this),
    }
  }

  async assertBriefingChatAccessible(
    annotationId: string,
    userId: number,
  ): Promise<void> {
    await this.briefingContext.loadContext(annotationId, userId)
  }

  async loadConversation(
    annotationId: string,
    userId: number,
  ): Promise<LoadConversationResult> {
    const { annotation } = await this.briefingContext.loadContext(
      annotationId,
      userId,
    )
    const conversationId = requireConversationId(annotation.chatConversationId)
    const conversation = await this.chatStore.findConversationByIdAndOwner(
      conversationId,
      userId,
    )
    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }
    const messages =
      await this.chatStore.listMessagesByConversation(conversationId)
    return { conversationId, messages }
  }

  async deleteConversation(
    annotationId: string,
    userId: number,
  ): Promise<void> {
    const { annotation } = await this.briefingContext.loadContext(
      annotationId,
      userId,
    )
    const conversationId = requireConversationId(annotation.chatConversationId)
    await this.chatStore.softDeleteConversation(conversationId, userId)
  }
}

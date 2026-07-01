import { Injectable } from '@nestjs/common'
import { ChatScope } from '../../../generated/prisma'
import type { LlmTool } from '@/llm/services/llm.service'
import {
  ChatScopeHandler,
  ResolveConversationParams,
  ResolveConversationResult,
} from '../types/chatScopeHandler'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'

// Sensitive scope: the agent is grounded in the candidate's own campaign data,
// so it runs Anthropic-only. The registry fails closed on any non-claude model.
export const CAMPAIGN_MANAGER_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const

type CampaignManagerContext = object

@Injectable()
export class CampaignManagerHandler implements ChatScopeHandler<CampaignManagerContext> {
  readonly scope = ChatScope.campaign_assistant
  readonly isSensitive = true
  readonly models = [...CAMPAIGN_MANAGER_MODELS]

  constructor(private readonly store: GeneralChatStoreService) {}

  // Mirrors Chief of Staff: every open creates a fresh conversation. Resuming a
  // prior chat goes through its id directly, so find-or-create here would
  // collapse every new chat onto the latest one.
  async resolveConversation(
    params: ResolveConversationParams,
    userId: number,
  ): Promise<ResolveConversationResult> {
    const created = await this.store.createScopedConversation({
      ownerUserId: userId,
      organizationSlug: params.organizationSlug,
      scope: ChatScope.campaign_assistant,
      ...(params.anchor && {
        anchor: params.anchor,
        title: params.anchor.snapshot.title,
      }),
    })
    return { conversationId: created.id, created: true }
  }

  async loadContext(): Promise<CampaignManagerContext> {
    return {}
  }

  buildSystemPrompt(): string {
    return ''
  }

  buildTools(): Record<string, LlmTool> {
    return {}
  }
}

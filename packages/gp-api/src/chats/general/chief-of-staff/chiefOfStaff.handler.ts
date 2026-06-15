import { Inject, Injectable, Optional } from '@nestjs/common'
import { z } from 'zod'
import { ChatScope } from '../../../generated/prisma'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import { buildWebSearchTool, SearchProvider } from '@/llm/tools/webSearch.tool'
import {
  ChatScopeHandler,
  ResolveConversationParams,
  ResolveConversationResult,
} from '../types/chatScopeHandler'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import {
  ChiefOfStaffContext,
  ChiefOfStaffContextService,
} from './services/chiefOfStaffContext.service'
import { ChiefOfStaffBriefingsService } from './services/chiefOfStaffBriefings.service'
import { buildChiefOfStaffSystemPrompt } from './services/chiefOfStaffPrompt'
import { buildCrudPrioritiesTool } from './services/crudPriorities.tool'
import {
  buildGetBriefingTool,
  buildListBriefingsTool,
} from './services/briefingReadTools'
import { PRIORITIES_PORT, PrioritiesToolPort } from './services/prioritiesPort'

// Sensitive scope: tool outputs (briefings, priorities, search results) flow
// back into the model context, so this scope runs Anthropic-only. The registry
// fails closed if any of these is not claude-routed.
export const CHIEF_OF_STAFF_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const

export const COS_SEARCH_PROVIDER = 'COS_SEARCH_PROVIDER'

@Injectable()
export class ChiefOfStaffHandler implements ChatScopeHandler<ChiefOfStaffContext> {
  readonly scope = ChatScope.chief_of_staff
  readonly isSensitive = true
  readonly models = [...CHIEF_OF_STAFF_MODELS]

  constructor(
    private readonly store: GeneralChatStoreService,
    private readonly contextService: ChiefOfStaffContextService,
    private readonly briefings: ChiefOfStaffBriefingsService,
    @Inject(PRIORITIES_PORT)
    private readonly priorities: PrioritiesToolPort,
    @Optional()
    @Inject(COS_SEARCH_PROVIDER)
    private readonly searchProvider?: SearchProvider,
  ) {}

  async resolveConversation(
    params: ResolveConversationParams,
    userId: number,
  ): Promise<ResolveConversationResult> {
    const key = {
      ownerUserId: userId,
      organizationSlug: params.organizationSlug,
      scope: ChatScope.chief_of_staff,
    }
    const existing = await this.store.findScopedConversation(key)
    if (existing) {
      return { conversationId: existing.id, created: false }
    }
    const created = await this.store.createScopedConversation(key)
    return { conversationId: created.id, created: true }
  }

  loadContext(
    conversationId: string,
    userId: number,
  ): Promise<ChiefOfStaffContext> {
    return this.contextService.load(conversationId, userId, this.priorities)
  }

  buildSystemPrompt(ctx: ChiefOfStaffContext): string {
    return buildChiefOfStaffSystemPrompt({
      ctx,
      toolNames: Object.keys(this.assembleTools(ctx)),
    })
  }

  buildTools(
    ctx: ChiefOfStaffContext,
  ): Record<string, LlmStreamTool<z.ZodTypeAny>> {
    return this.assembleTools(ctx)
  }

  private assembleTools(
    ctx: ChiefOfStaffContext,
  ): Record<string, LlmStreamTool<z.ZodTypeAny>> {
    const tools: Record<string, LlmStreamTool<z.ZodTypeAny>> = {}

    tools.crud_priorities = buildCrudPrioritiesTool({
      port: this.priorities,
      electedOfficeId: ctx.electedOfficeId,
    })

    const briefingProvider = this.briefings.forElectedOffice(
      ctx.electedOfficeId,
    )
    tools.list_briefings = buildListBriefingsTool({
      provider: briefingProvider,
    })
    tools.get_briefing = buildGetBriefingTool({ provider: briefingProvider })

    if (this.searchProvider) {
      tools.web_search = buildWebSearchTool({ provider: this.searchProvider })
    }

    return tools
  }
}

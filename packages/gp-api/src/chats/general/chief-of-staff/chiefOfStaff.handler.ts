import { Inject, Injectable, Optional } from '@nestjs/common'
import { z } from 'zod'
import { ChatScope } from '../../../generated/prisma'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import {
  buildDescribeConstituentDataTool,
  buildQueryConstituentDataTool,
} from '@/llm/tools/queryConstituentData.tool'
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
import { buildConstituentDataScope } from './services/constituentDataScope'
import { buildCrudPrioritiesTool } from './services/crudPriorities.tool'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
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

// Token for the SCOPED, aggregate-only Databricks provider. Distinct from the
// briefing chat's broad provider. Bound to a factory that returns null unless a
// dedicated SERVE_DATABRICKS_* credential is configured, so the tool stays
// unregistered until that scoped key is deployed.
export const CONSTITUENT_DATA_PROVIDER = 'CONSTITUENT_DATA_PROVIDER'

// Prod enablement = deploying the scoped SERVE_DATABRICKS_* credential (and the
// approved table/dimensions). There is NO Amplitude gate on the hard register
// path, so a local key-swap turns the tool on without touching Amplitude. This
// flag is kept only for optional product-side metering/visibility.
export { CONSTITUENT_DATA_TOOL_FLAG } from '@/llm/tools/queryConstituentData.tool'

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
    @Optional()
    @Inject(CONSTITUENT_DATA_PROVIDER)
    private readonly constituentProvider?: DatabricksProvider,
    @Optional()
    private readonly districtResolver?: DistrictResolverService,
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

  async loadContext(
    conversationId: string,
    userId: number,
  ): Promise<ChiefOfStaffContext> {
    const ctx = await this.contextService.load(
      conversationId,
      userId,
      this.priorities,
    )
    const resolved = await this.districtResolver?.resolveByUserId(userId)
    if (!resolved) return ctx
    return {
      ...ctx,
      jurisdiction: `${resolved.l2DistrictName}, ${resolved.state}`,
      districtFilters: this.districtResolver
        ? this.districtResolver.toMandatoryFilters(resolved)
        : null,
    }
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

    // Aggregate-only constituent data. Registers ONLY when all three hold: the
    // scoped provider is configured (SERVE_DATABRICKS_* present), the user's
    // district resolved into server-bound filters, and an approved table is
    // configured. Any one missing keeps the tool off — prod/local stay off
    // until the scoped key is deployed.
    if (this.constituentProvider && ctx.districtFilters) {
      const scope = buildConstituentDataScope(ctx.districtFilters)
      if (scope.allowedTables.size > 0) {
        tools.query_constituent_data = buildQueryConstituentDataTool({
          provider: this.constituentProvider,
          scope,
        })
        tools.describe_constituent_data = buildDescribeConstituentDataTool({
          scope,
        })
      }
    }

    return tools
  }
}

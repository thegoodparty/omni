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
import {
  buildConstituentDataScope,
  ConstituentTableConfig,
} from './services/constituentDataScope'
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

// Token for the aggregate-only Databricks provider. Bound to a factory that
// reads the SAME shared DATABRICKS_* credential the briefing chat uses, so the
// tool stays unregistered until that key is configured.
export const CONSTITUENT_DATA_PROVIDER = 'CONSTITUENT_DATA_PROVIDER'

// Token for the app-layer table/dimension allowlist (lever 1). Injected so prod
// uses the in-code CONSTITUENT_TABLES const while tests can supply a fixture.
export const CONSTITUENT_TABLES_CONFIG = 'CONSTITUENT_TABLES_CONFIG'

// Prod enablement = configuring the shared DATABRICKS_* credential AND adding an
// approved table to CONSTITUENT_TABLES. There is NO Amplitude gate on the hard
// register path. This flag is kept only for optional product-side
// metering/visibility.
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
    @Inject(CONSTITUENT_TABLES_CONFIG)
    private readonly constituentTables: ConstituentTableConfig[],
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
    // provider is configured (shared DATABRICKS_* present), the user's district
    // resolved into server-bound filters, and an approved table is in the
    // in-code allowlist. Any one missing keeps the tool off.
    if (this.constituentProvider && ctx.districtFilters) {
      const scope = buildConstituentDataScope(
        ctx.districtFilters,
        this.constituentTables,
      )
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

import { Inject, Injectable, Optional } from '@nestjs/common'
import { z } from 'zod'
import { ChatScope } from '../../../generated/prisma'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import {
  buildDescribeConstituentDataTool,
  buildQueryConstituentDataTool,
  CONSTITUENT_DATA_TOOL_FLAG,
} from '@/llm/tools/queryConstituentData.tool'
import { FeaturesService } from '@/features/services/features.service'
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

// Enablement requires ALL of: the shared DATABRICKS_* credential, an approved
// table in CONSTITUENT_TABLES, the user's district resolving to server-bound
// filters, AND the per-user cos-constituent-data-tool Amplitude flag being on.
// The flag is the rollout control while the tool runs against the shared (broad)
// key: it stays off for everyone until explicitly enabled per internal tester.
export { CONSTITUENT_DATA_TOOL_FLAG }

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
    @Optional()
    private readonly features?: FeaturesService,
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
    const districtFilters = this.districtResolver
      ? this.districtResolver.toMandatoryFilters(resolved)
      : null
    // Resolve the per-user flag only when the tool could otherwise register
    // (provider + an approved table present), so we don't hit Amplitude for
    // users who can't use it anyway.
    const constituentToolEnabled =
      !!this.constituentProvider &&
      this.constituentTables.length > 0 &&
      (await this.isConstituentToolFlagOn(userId))
    return {
      ...ctx,
      jurisdiction: `${resolved.l2DistrictName}, ${resolved.state}`,
      districtFilters,
      constituentToolEnabled,
    }
  }

  // FeaturesService.isFeatureEnabled throws if Amplitude fails to return a
  // value. Resolving the flag is on the critical path of every CoS message, so
  // a flag-service outage must degrade to "tool off", never take down the chat.
  private async isConstituentToolFlagOn(userId: number): Promise<boolean> {
    if (!this.features) return false
    try {
      return await this.features.isFeatureEnabled({
        user: userId,
        feature: CONSTITUENT_DATA_TOOL_FLAG,
      })
    } catch {
      return false
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

    // Aggregate-only constituent data. Registers ONLY when all of: the provider
    // is configured (shared DATABRICKS_* present), the user's district resolved
    // into server-bound filters, an approved table is in the in-code allowlist,
    // AND the per-user cos-constituent-data-tool flag is on. Any one missing
    // keeps the tool off.
    if (
      this.constituentProvider &&
      ctx.districtFilters &&
      ctx.constituentToolEnabled
    ) {
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

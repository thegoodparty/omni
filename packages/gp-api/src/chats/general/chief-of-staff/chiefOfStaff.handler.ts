import { Inject, Injectable, Optional } from '@nestjs/common'
import { ChatScope } from '../../../generated/prisma'
import type { LlmTool } from '@/llm/services/llm.service'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import {
  buildDescribeConstituentDataTool,
  buildQueryConstituentDataTool,
  CONSTITUENT_DATA_TOOL_FLAG,
} from '@/llm/tools/queryConstituentData.tool'
import { FeaturesService } from '@/features/services/features.service'
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
import { professionalAdviceDisclaimer } from './services/professionalAdviceCheck'
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
import {
  COMMUNITY_ISSUE_READ_PORT,
  CommunityIssueReadPort,
} from './services/communityIssueRead.port'
import { buildReadCommunityIssuesTool } from './services/communityIssueRead.tool'
import { ContactsService } from '@/contacts/services/contacts.service'
import { buildDescribeFilterDimensionsTool } from '../crm-tools/describeFilterDimensions.tool'
import { buildCountContactsTool } from '../crm-tools/countContacts.tool'
import { buildCrudSavedFiltersTool } from '../crm-tools/crudSavedFilters.tool'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'

// Sensitive scope: tool outputs (briefings, priorities, search results) flow
// back into the model context, so this scope runs Anthropic-only. The registry
// fails closed if any of these is not claude-routed.
export const CHIEF_OF_STAFF_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const

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

// Serve's CRM rollout flag (same key the webapp's contacts page reads). It
// gates the contact describe/count tools so the assistant capability ramps
// with the same cohorts as the CRM UI.
export const SERVE_CRM_FLAG = 'serve-crm'

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
    @Inject(CONSTITUENT_DATA_PROVIDER)
    private readonly constituentProvider?: DatabricksProvider,
    @Optional()
    private readonly districtResolver?: DistrictResolverService,
    @Optional()
    private readonly features?: FeaturesService,
    @Optional()
    @Inject(COMMUNITY_ISSUE_READ_PORT)
    private readonly communityIssueRead?: CommunityIssueReadPort,
    @Optional()
    private readonly contacts?: ContactsService,
    @Optional()
    private readonly voterFileFilters?: VoterFileFilterService,
  ) {}

  async resolveConversation(
    params: ResolveConversationParams,
    userId: number,
  ): Promise<ResolveConversationResult> {
    // Chief of Staff supports multiple conversations, so every "new chat"
    // creates a fresh one rather than resuming the most recent. Resuming a
    // prior chat goes through its conversation id directly (history →
    // listMessages → stream), never through here — so find-or-create here would
    // collapse every new chat onto the latest existing conversation.
    const created = await this.store.createScopedConversation({
      ownerUserId: userId,
      organizationSlug: params.organizationSlug,
      scope: ChatScope.chief_of_staff,
      ...(params.anchor && {
        anchor: params.anchor,
        title: params.anchor.snapshot.title,
      }),
    })
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
    // Resolved independently of district resolution: the contact tools go
    // through ContactsService, which does its own district lookup. Only hit
    // Amplitude when the tools could otherwise register (service injected).
    const crmToolsEnabled =
      !!this.contacts && (await this.isFlagOn(userId, SERVE_CRM_FLAG))
    const resolved = await this.districtResolver?.resolveByUserId(userId)
    if (!resolved) return { ...ctx, crmToolsEnabled }
    const districtFilters = this.districtResolver
      ? this.districtResolver.toMandatoryFilters(resolved)
      : null
    // Resolve the per-user flag only when the tool could otherwise register
    // (provider + an approved table present), so we don't hit Amplitude for
    // users who can't use it anyway.
    const constituentToolEnabled =
      !!this.constituentProvider &&
      this.constituentTables.length > 0 &&
      (await this.isFlagOn(userId, CONSTITUENT_DATA_TOOL_FLAG))
    return {
      ...ctx,
      jurisdiction: `${resolved.l2DistrictName}, ${resolved.state}`,
      districtFilters,
      constituentToolEnabled,
      crmToolsEnabled,
    }
  }

  // FeaturesService.isFeatureEnabled throws if Amplitude fails to return a
  // value. Resolving a flag is on the critical path of every CoS message, so
  // a flag-service outage must degrade to "tool off", never take down the chat.
  private async isFlagOn(userId: number, feature: string): Promise<boolean> {
    if (!this.features) return false
    try {
      return await this.features.isFeatureEnabled({ user: userId, feature })
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

  buildTools(ctx: ChiefOfStaffContext): Record<string, LlmTool> {
    return this.assembleTools(ctx)
  }

  // Tier-1 deterministic backstop: if a turn gave professional-domain advice
  // (legal/medical/financial/HR) but skipped the disclaimer the prompt asks
  // for, append it. See professionalAdviceCheck.ts.
  finalizeAssistantText(text: string): string | null {
    return professionalAdviceDisclaimer(text)
  }

  private assembleTools(ctx: ChiefOfStaffContext): Record<string, LlmTool> {
    const tools: Record<string, LlmTool> = {}

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

    // Web search runs through Anthropic's native tool (the chat is Claude-only)
    // so queries stay within the enterprise agreement rather than going to a
    // third party. Gated on the key here too (not just in the LLM layer) so the
    // system prompt never advertises a tool that wasn't registered.
    if (process.env.ANTHROPIC_API_KEY) {
      tools.web_search = { kind: 'native_web_search', maxUses: 5 }
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

    if (this.communityIssueRead) {
      tools.read_community_issues = buildReadCommunityIssuesTool({
        port: this.communityIssueRead,
        organizationSlug: ctx.organizationSlug,
        electedOfficeId: ctx.electedOfficeId,
      })
    }

    // Aggregate-only CRM reads (describe dimensions + count), gated on the
    // serve-crm flag so the assistant capability ramps with the CRM UI. The
    // org is bound from the resolved context; ContactsService enforces the
    // Serve party rejection and every other filter rule.
    if (this.contacts && ctx.crmToolsEnabled) {
      tools.describe_filter_dimensions = buildDescribeFilterDimensionsTool({
        contacts: this.contacts,
        organization: ctx.organization,
      })
      tools.count_contacts = buildCountContactsTool({
        contacts: this.contacts,
        organization: ctx.organization,
      })
      // Saved-filter CRUD goes through the same VoterFileFilterService paths
      // as the voter-file routes (completed-outreach validation, org scoping,
      // locked-filter conflict all inherited). Registered under the same
      // serve-crm gate; the prompt rules key off the registered tool name.
      if (this.voterFileFilters) {
        tools.crud_saved_filters = buildCrudSavedFiltersTool({
          voterFileFilters: this.voterFileFilters,
          contacts: this.contacts,
          organization: ctx.organization,
        })
      }
    }

    return tools
  }
}

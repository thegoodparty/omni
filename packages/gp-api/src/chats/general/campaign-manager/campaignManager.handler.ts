import { Inject, Injectable, Optional } from '@nestjs/common'
import { differenceInCalendarWeeks, parseISO } from 'date-fns'
import { ChatMessageRole, ChatScope } from '../../../generated/prisma'
import type { LlmTool } from '@/llm/services/llm.service'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { ChatStoreService } from '@/chats/services/chatStore.prisma'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { FeaturesService } from '@/features/services/features.service'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import {
  buildDescribeConstituentDataTool,
  buildQueryConstituentDataTool,
} from '@/llm/tools/queryConstituentData.tool'
import {
  buildConstituentDataScope,
  ConstituentTableConfig,
} from '../chief-of-staff/services/constituentDataScope'
import {
  ChatScopeHandler,
  ResolveConversationParams,
  ResolveConversationResult,
} from '../types/chatScopeHandler'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import {
  buildCampaignManagerSystemPrompt,
  CampaignManagerContext,
} from './campaignManagerPrompt'
import { selectTopDynamicTasks } from './selectTopDynamicTasks'

// Sensitive scope: the agent is grounded in the candidate's own campaign data,
// so it runs Anthropic-only. The registry fails closed on any non-claude model.
export const CAMPAIGN_MANAGER_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const

// The scripted opener, persisted as the conversation's first assistant message
// so the agent keeps its own greeting in context on later turns. Mirrors the
// client-played CAMPAIGN_MANAGER_INTRO in gp-webapp (kept in sync by hand; it is
// display copy, not a cross-service contract).
export const CAMPAIGN_MANAGER_GREETING = [
  "Hi, I'm your campaign manager.",
  'I keep an eye on your plan and tell you the two or three things that ' +
    'matter most this week, and what to do about them.',
  'Ask me what to do next, or tell me what just happened and I will help ' +
    'you handle it.',
].join('\n\n')

// Campaign Manager's own rollout flag for the constituent-data tool, distinct
// from Chief of Staff's. Off until enabled per internal tester while the tool
// runs against the shared (broad) Databricks credential.
export const CM_CONSTITUENT_DATA_TOOL_FLAG = 'cm-constituent-data-tool'

// Injection tokens for the aggregate-only Databricks provider and the in-code
// table allowlist, provided by CampaignManagerModule.
export const CM_CONSTITUENT_DATA_PROVIDER = 'CM_CONSTITUENT_DATA_PROVIDER'
export const CM_CONSTITUENT_TABLES_CONFIG = 'CM_CONSTITUENT_TABLES_CONFIG'

const EMPTY_CONTEXT: CampaignManagerContext = {
  candidateFirstName: null,
  officeName: null,
  location: null,
  weeksToElection: null,
  topTasks: [],
  districtFilters: null,
  constituentToolEnabled: false,
}

@Injectable()
export class CampaignManagerHandler implements ChatScopeHandler<CampaignManagerContext> {
  readonly scope = ChatScope.campaign_assistant
  readonly isSensitive = true
  readonly models = [...CAMPAIGN_MANAGER_MODELS]

  constructor(
    private readonly store: GeneralChatStoreService,
    private readonly campaigns: CampaignsService,
    private readonly chatStore: ChatStoreService,
    @Inject(CM_CONSTITUENT_TABLES_CONFIG)
    private readonly constituentTables: ConstituentTableConfig[],
    @Optional()
    @Inject(CM_CONSTITUENT_DATA_PROVIDER)
    private readonly constituentProvider?: DatabricksProvider,
    @Optional()
    private readonly districtResolver?: DistrictResolverService,
    @Optional()
    private readonly features?: FeaturesService,
  ) {}

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
    // Persist the scripted greeting as the first assistant message so later
    // turns carry the manager's own opener in context (toLlmMessages folds this
    // leading assistant turn into the system prompt). The client still plays it
    // on open.
    await this.chatStore.appendMessage({
      conversationId: created.id,
      role: ChatMessageRole.assistant,
      content: CAMPAIGN_MANAGER_GREETING,
    })
    return { conversationId: created.id, created: true }
  }

  async loadContext(
    conversationId: string,
    userId: number,
  ): Promise<CampaignManagerContext> {
    const conversation = await this.store.findFirst({
      where: { id: conversationId, ownerUserId: userId },
    })
    const organizationSlug = conversation?.organizationSlug
    if (!organizationSlug) return EMPTY_CONTEXT

    const campaign = await this.campaigns.findFirst({
      where: { organizationSlug },
    })
    if (!campaign) return EMPTY_CONTEXT

    const tasks = await this.campaigns.client.campaignTrackerTask.findMany({
      where: { campaignId: campaign.id },
    })
    const details = campaign.details
    const electionDate = details.electionDate ?? details.primaryElectionDate
    const location =
      [details.city, details.state].filter(Boolean).join(', ') || null

    // Scope constituent queries to the campaign's district (from its org's
    // position), same shape Chief of Staff uses. Resolving the flag only when
    // the tool could otherwise register avoids an Amplitude call for candidates
    // who can't use it anyway.
    const resolved =
      await this.districtResolver?.resolveByOrgSlug(organizationSlug)
    const districtFilters =
      resolved && this.districtResolver
        ? this.districtResolver.toMandatoryFilters(resolved)
        : null
    const constituentToolEnabled =
      !!this.constituentProvider &&
      this.constituentTables.length > 0 &&
      (await this.isConstituentToolFlagOn(userId))

    return {
      candidateFirstName: null,
      officeName: details.normalizedOffice ?? null,
      location,
      weeksToElection: electionDate
        ? differenceInCalendarWeeks(parseISO(electionDate), new Date())
        : null,
      topTasks: selectTopDynamicTasks(tasks).map((t) => ({
        title: t.title,
        date: t.date,
      })),
      districtFilters,
      constituentToolEnabled,
    }
  }

  // FeaturesService.isFeatureEnabled throws if Amplitude fails to return a
  // value. Resolving the flag is on the critical path of loadContext, so a
  // flag-service outage must degrade to "tool off", never take down the chat.
  private async isConstituentToolFlagOn(userId: number): Promise<boolean> {
    if (!this.features) return false
    try {
      return await this.features.isFeatureEnabled({
        user: userId,
        feature: CM_CONSTITUENT_DATA_TOOL_FLAG,
      })
    } catch {
      return false
    }
  }

  buildSystemPrompt(ctx: CampaignManagerContext): string {
    return buildCampaignManagerSystemPrompt(ctx)
  }

  buildTools(ctx: CampaignManagerContext): Record<string, LlmTool> {
    const tools: Record<string, LlmTool> = {}

    // Web search runs through Anthropic's native tool (the scope is Claude-only)
    // so queries stay within the enterprise agreement. Gated on the key here so
    // the system prompt never advertises a tool that was not registered.
    if (process.env.ANTHROPIC_API_KEY) {
      tools.web_search = { kind: 'native_web_search', maxUses: 5 }
    }

    // Aggregate-only constituent data, reusing the Chief of Staff building
    // blocks (shared Databricks provider + serve_agent_voters allowlist + SQL
    // validator + cell-size floor). Registers only when the provider is
    // configured, the campaign's district resolved into server-bound filters,
    // and the per-user rollout flag is on — otherwise it stays dark.
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

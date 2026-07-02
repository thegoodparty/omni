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
import {
  CampaignStoryIntakeService,
  type StoryField,
  type StoryState,
} from './campaignStoryIntake.service'
import { buildCampaignStoryTool } from './campaignStoryTool'

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

// The next-question prompt per story field, in the Story page's wording.
const STORY_QUESTION_PROMPTS: Record<StoryField, string> = {
  why:
    'your why: the moment, the people, the breaking point, your stump-speech ' +
    'opener. What made you decide to run?',
  background:
    'your background: childhood, career, and community ties, the human story ' +
    'behind you. Tell me a little about yourself.',
  positions:
    'your positions: the two to four concrete fights you would take on in ' +
    'your first term. What are they?',
}

// Story-aware, resume-aware opener seeded when the Campaign Story is unfinished:
// introduces the manager (or welcomes them back if they've answered some), then
// asks the FIRST still-missing question so reopening picks up where they left
// off. Uses the Story page's wording.
export const buildStoryGreeting = (story: StoryState): string => {
  const next = story.missing[0] ?? 'why'
  const answered = 3 - story.missing.length
  const intro =
    answered === 0
      ? [
          "Hi, I'm your campaign manager. Before I build your plan and " +
            "tracker, let's get your Campaign Story down, since it's what " +
            'personalizes your Campaign Plan, Campaign Tracker, and your ' +
            'GoodParty.org experience.',
          "It's just three short questions, in your own words, and I can " +
            'help sharpen anything you write.',
        ]
      : [
          "Welcome back. Let's finish your Campaign Story so I can build " +
            'your plan and tracker.',
        ]
  const lead = answered === 0 ? 'First' : 'Next'
  return [...intro, `${lead}, ${STORY_QUESTION_PROMPTS[next]}`].join('\n\n')
}

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
  candidateName: '',
  campaignId: null,
  officeName: null,
  location: null,
  weeksToElection: null,
  topTasks: [],
  districtFilters: null,
  constituentToolEnabled: false,
  story: null,
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
    @Optional()
    private readonly storyIntake?: CampaignStoryIntakeService,
  ) {}

  // The manager is a single ongoing conversation, not one per open: resume the
  // candidate's most recent thread so "meet" and reopening continue where they
  // left off, showing the seeded greeting and full transcript. Only when none
  // exists do we create one and seed the greeting. (Anchored chats, unused by
  // the manager today, always create fresh.)
  async resolveConversation(
    params: ResolveConversationParams,
    userId: number,
  ): Promise<ResolveConversationResult> {
    if (!params.anchor) {
      const existing = await this.store.findLatestByScope({
        ownerUserId: userId,
        organizationSlug: params.organizationSlug,
        scope: ChatScope.campaign_assistant,
      })
      if (existing) return { conversationId: existing.id, created: false }
    }
    // Resolve the greeting before the create so the async find->create window
    // (which two concurrent opens could both slip through) is as narrow as
    // possible. A duplicate here is benign, not corrupting: the extra thread is
    // orphaned and the next open resumes the most recent one. A DB-level guard
    // isn't available: this table is shared with Chief of Staff, which requires
    // MANY conversations per (user, org, scope), so a unique constraint on those
    // columns can't be added.
    const greeting = await this.resolveGreeting(params.organizationSlug)
    const created = await this.store.createScopedConversation({
      ownerUserId: userId,
      organizationSlug: params.organizationSlug,
      scope: ChatScope.campaign_assistant,
      ...(params.anchor && {
        anchor: params.anchor,
        title: params.anchor.snapshot.title,
      }),
    })
    // Persist the resume-aware greeting as the first assistant message so it is
    // shown on open (the client loads the conversation) and later turns carry
    // the manager's own opener in context (toLlmMessages folds this leading
    // assistant turn into the system prompt).
    await this.chatStore.appendMessage({
      conversationId: created.id,
      role: ChatMessageRole.assistant,
      content: greeting,
    })
    return { conversationId: created.id, created: true }
  }

  // Seed the story-intake opener when the Campaign Story is unfinished (so the
  // manager greets and asks its first question on open); otherwise the standard
  // greeting. Best-effort: any lookup miss falls back to the standard greeting.
  private async resolveGreeting(
    organizationSlug: string | null,
  ): Promise<string> {
    if (!organizationSlug || !this.storyIntake) return CAMPAIGN_MANAGER_GREETING
    const campaign = await this.campaigns.findFirst({
      where: { organizationSlug },
    })
    if (!campaign) return CAMPAIGN_MANAGER_GREETING
    const story = await this.storyIntake.read(campaign.id)
    return story.complete
      ? CAMPAIGN_MANAGER_GREETING
      : buildStoryGreeting(story)
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

    const campaign = await this.campaigns.client.campaign.findFirst({
      where: { organizationSlug },
      include: { user: true },
    })
    if (!campaign) return EMPTY_CONTEXT

    const tasks = await this.campaigns.client.campaignTrackerTask.findMany({
      where: { campaignId: campaign.id },
    })
    const candidateName = campaign.user
      ? [campaign.user.firstName, campaign.user.lastName]
          .filter(Boolean)
          .join(' ')
      : ''
    const story = this.storyIntake
      ? await this.storyIntake.read(campaign.id)
      : null
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
      candidateFirstName: campaign.user?.firstName ?? null,
      candidateName,
      campaignId: campaign.id,
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
      story,
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

    // Campaign Story intake: read/elaborate/save the candidate's story and,
    // once complete, kick off plan + tracker generation. Registered whenever
    // the intake service + campaign are resolved; the prompt drives when to run
    // it (unfinished story) vs. leave it (finished, edit-on-request only).
    if (this.storyIntake && ctx.campaignId !== null) {
      tools.campaign_story = buildCampaignStoryTool({
        intake: this.storyIntake,
        campaignId: ctx.campaignId,
        candidateName: ctx.candidateName,
      })
    }

    return tools
  }
}

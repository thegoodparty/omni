import { Inject, Injectable, Optional } from '@nestjs/common'
import { differenceInCalendarWeeks, parseISO } from 'date-fns'
import {
  CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
  CAMPAIGN_MANAGER_START_STORY_SENTINEL,
} from '@goodparty_org/contracts'
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
import type { ConstituentTableConfig } from '../chief-of-staff/services/constituentDataScope'
import { buildWinConstituentDataScope } from './services/constituentDataScope'
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
import { ContactsService } from '@/contacts/services/contacts.service'
import { buildDescribeFilterDimensionsTool } from '../crm-tools/describeFilterDimensions.tool'
import { buildCountContactsTool } from '../crm-tools/countContacts.tool'
import { buildCrudSavedFiltersTool } from '../crm-tools/crudSavedFilters.tool'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'

// Sensitive scope: the agent is grounded in the candidate's own campaign data,
// so it runs Anthropic-only. The registry fails closed on any non-claude model.
export const CAMPAIGN_MANAGER_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const

// The scripted opener, persisted as the conversation's first assistant message
// so the agent keeps its own greeting in context on later turns. Mirrors the
// client-played CAMPAIGN_MANAGER_INTRO in gp-webapp (kept in sync by hand; it is
// display copy, not a cross-service contract). First-name aware: falls back to
// a no-name variant when the candidate's first name isn't resolved.
export const buildCampaignManagerGreeting = (
  firstName?: string | null,
): string =>
  [
    firstName
      ? `Hi ${firstName}, I'm your Campaign Manager.`
      : "Hi, I'm your Campaign Manager.",
    "I can help you do things like understand your community's biggest " +
      'priorities, draft voter outreach, or prepare for upcoming events.',
    'How can I help today?',
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
// leads into the story (or welcomes them back if they've answered some), then
// asks the FIRST still-missing question so reopening picks up where they left
// off. Uses the Story page's wording. Deliberately does NOT re-introduce the
// manager ("Hi, I'm your campaign manager"): this runs after the general
// greeting on the in-chat "Personalize" chip path, and re-greeting there reads
// as a jarring double hello.
export const buildStoryGreeting = (story: StoryState): string => {
  const next = story.missing[0] ?? 'why'
  const answered = 3 - story.missing.length
  const intro =
    answered === 0
      ? [
          "Before I build your plan and tracker, let's get your Campaign " +
            "Story down, since it's what personalizes your Campaign Plan, " +
            'Campaign Tracker, and your GoodParty.org experience.',
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

// Canned reply for the product-overview sentinel (the "Learn more about the
// product" chip). Independent of the candidate's Campaign Story state, so it
// answers the same way whether the story is missing, in progress, or done.
const CAMPAIGN_MANAGER_PRODUCT_OVERVIEW = [
  "I'm your campaign manager, here to help you run and win.",
  'GoodParty.org gives you a personalized campaign plan, a weekly tracker ' +
    'of your highest-impact tasks, voter outreach tools like texting, ' +
    'door-knocking scripts, and social posts, and a free candidate website.',
  'Tell me what you are working on and I will point you to the next best ' +
    'step. When you are ready, tap Personalize your campaign and I will ' +
    'tailor everything to your race.',
].join('\n\n')

// Campaign Manager's own rollout flag for the constituent-data tool, distinct
// from Chief of Staff's. Off until enabled per internal tester while the tool
// runs against the shared (broad) Databricks credential.
export const CM_CONSTITUENT_DATA_TOOL_FLAG = 'cm-constituent-data-tool'

// Injection tokens for the aggregate-only Databricks provider and the in-code
// table allowlist, provided by CampaignManagerModule.
export const CM_CONSTITUENT_DATA_PROVIDER = 'CM_CONSTITUENT_DATA_PROVIDER'
export const CM_CONSTITUENT_TABLES_CONFIG = 'CM_CONSTITUENT_TABLES_CONFIG'

// All-fields-missing StoryState, used as the safe fallback when the sentinel
// is intercepted but the campaign context couldn't be resolved (EMPTY_CONTEXT).
// buildStoryGreeting only reads `missing`/`missing.length`, so this always
// renders the fresh (not "welcome back") intake opener.
const EMPTY_STORY_STATE: StoryState = {
  why: null,
  background: null,
  positions: [],
  complete: false,
  missing: ['why', 'background', 'positions'],
}

// Win's CRM rollout flag (same key the webapp's contacts page reads). The
// contact describe/count tools require it, mirroring the webapp's
// useCrmEnabled gate, so the assistant capability ramps with exactly the
// same cohorts as the UI.
export const WIN_CRM_FLAG = 'win-crm'

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
  organization: null,
  crmToolsEnabled: false,
  savedFilterToolsEnabled: false,
  story: null,
  plan: null,
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
    @Optional()
    private readonly contacts?: ContactsService,
    @Optional()
    private readonly voterFileFilters?: VoterFileFilterService,
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

  // Always seeds the general greeting (Campaign Story intake now runs on
  // demand via the kickoff sentinel, not at conversation creation). First-name
  // aware when the campaign's owning user resolves. Best-effort: any lookup
  // miss falls back to the no-name greeting rather than throwing.
  private async resolveGreeting(
    organizationSlug: string | null,
  ): Promise<string> {
    if (!organizationSlug) return buildCampaignManagerGreeting()
    const campaign = await this.campaigns.findFirst({
      where: { organizationSlug },
      include: { user: true },
    })
    if (!campaign) return buildCampaignManagerGreeting()
    return buildCampaignManagerGreeting(campaign.user?.firstName)
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
    const [story, plan] = this.storyIntake
      ? await Promise.all([
          this.storyIntake.read(campaign.id),
          this.storyIntake.readPlan(campaign.id),
        ])
      : [null, null]
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
      (await this.isFlagOn(userId, CM_CONSTITUENT_DATA_TOOL_FLAG))

    // The org row the CRM contact tools bind counts to. Folding the service
    // presence into crmToolsEnabled keeps prompt advertising and tool
    // registration on one signal; only look up the org and hit Amplitude when
    // the tools could otherwise register.
    const organization = this.contacts
      ? await this.campaigns.client.organization.findFirst({
          where: { slug: organizationSlug },
        })
      : null
    const crmToolsEnabled =
      !!this.contacts &&
      !!organization &&
      (await this.isFlagOn(userId, WIN_CRM_FLAG))
    // The saved-filter write tool additionally needs VoterFileFilterService;
    // folding its presence in keeps prompt advertising and tool registration
    // on one signal, same as crmToolsEnabled itself.
    const savedFilterToolsEnabled = crmToolsEnabled && !!this.voterFileFilters

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
      organization,
      crmToolsEnabled,
      savedFilterToolsEnabled,
      story,
      plan,
    }
  }

  // FeaturesService.isFeatureEnabled throws if Amplitude fails to return a
  // value. Resolving a flag is on the critical path of loadContext, so a
  // flag-service outage must degrade to "tool off", never take down the chat.
  private async isFlagOn(userId: number, feature: string): Promise<boolean> {
    if (!this.features) return false
    try {
      return await this.features.isFeatureEnabled({ user: userId, feature })
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

    // Aggregate-only constituent data against the dedicated Win mart
    // (sp_win_agent credential + win_agent_voters allowlist + the shared SQL
    // validator + cell-size floor). Registers only when the provider is
    // configured, the campaign's district resolved into server-bound filters,
    // and the per-user rollout flag is on — otherwise it stays dark.
    if (
      this.constituentProvider &&
      ctx.districtFilters &&
      ctx.constituentToolEnabled
    ) {
      const scope = buildWinConstituentDataScope(
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

    // Aggregate-only CRM reads (describe dimensions + count), gated on the
    // win-crm flag so the assistant capability ramps with the CRM UI. The
    // org is bound from the resolved context; ContactsService enforces the
    // pro gate and every other filter rule.
    if (this.contacts && ctx.crmToolsEnabled && ctx.organization) {
      tools.describe_filter_dimensions = buildDescribeFilterDimensionsTool({
        contacts: this.contacts,
        organization: ctx.organization,
      })
      tools.count_contacts = buildCountContactsTool({
        contacts: this.contacts,
        organization: ctx.organization,
      })
      // Saved-filter CRUD goes through the same VoterFileFilterService paths
      // as the voter-file routes (Pro gate, completed-outreach validation,
      // org scoping, locked-filter conflict all inherited).
      if (this.voterFileFilters && ctx.savedFilterToolsEnabled) {
        tools.crud_saved_filters = buildCrudSavedFiltersTool({
          voterFileFilters: this.voterFileFilters,
          contacts: this.contacts,
          organization: ctx.organization,
        })
      }
    }

    return tools
  }

  // Kicks off Campaign Story intake without a model round-trip when the
  // client sends the reserved sentinel (e.g. "Get started" on a fresh
  // conversation). Returns null for any other message, which runs the normal
  // LLM turn.
  maybeCannedReply(
    userMessage: string,
    ctx: CampaignManagerContext,
  ): string | null {
    const message = userMessage.trim()
    if (message === CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL) {
      return CAMPAIGN_MANAGER_PRODUCT_OVERVIEW
    }
    if (message !== CAMPAIGN_MANAGER_START_STORY_SENTINEL) {
      return null
    }
    // The sentinel must never reach the LLM: even without a resolved campaign
    // context (missing org slug, or the campaign row not found), fall back to
    // the all-missing intake greeting so the candidate still gets prompted.
    if (!ctx.story) return buildStoryGreeting(EMPTY_STORY_STATE)
    return ctx.story.complete
      ? 'Your Campaign Story is all set. Tell me what you would like to ' +
          'change and I can help you refine it.'
      : buildStoryGreeting(ctx.story)
  }
}

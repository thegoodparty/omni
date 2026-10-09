import { Inject, Injectable, Optional } from '@nestjs/common'
import {
  CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
  CAMPAIGN_MANAGER_START_STORY_SENTINEL,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import {
  type Campaign,
  ChatMessageRole,
  ChatScope,
} from '../../../generated/prisma'
import type { LlmTool } from '@/llm/services/llm.service'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { ChatStoreService } from '@/chats/services/chatStore.prisma'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
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
} from '../types/chatScopeHandler'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import { professionalAdviceDisclaimer } from '../services/professionalAdviceCheck'
import {
  buildCampaignManagerSystemPrompt,
  CampaignManagerContext,
  currentPageBlock,
  LEGAL_LINE,
  type LiveRace,
} from './campaignManagerPrompt'
import { localDay } from '../services/todayLine'
import { selectTopDynamicTasks } from './selectTopDynamicTasks'
import { CampaignStoryIntakeService } from './campaignStoryIntake.service'
import type {
  StoryField,
  StoryState,
} from '@/campaignStory/services/campaignStoryState.service'
import { buildCampaignStoryTool } from './campaignStoryTool'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  buildDescribeFilterDimensionsTool,
  registeredFilterConsumers,
} from '../crm-tools/describeFilterDimensions.tool'
import { buildCountContactsTool } from '../crm-tools/countContacts.tool'
import { buildListPrecinctsTool } from '../crm-tools/listPrecincts.tool'
import { buildCrudSavedFiltersTool } from '../crm-tools/crudSavedFilters.tool'
import { buildSizeOutreachSampleTool } from '../chat-tools/sizeOutreachSample.tool'
import { buildCampaignManagerOutreachProposalTool } from '../chat-tools/presentOutreachProposal.tool'
import { buildCampaignManagerListProposalTool } from '../crm-tools/presentListProposal.tool'
import { buildShowListMapTool } from '../crm-tools/showListMap.tool'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { parseBallotStatus } from '@/campaigns/schemas/ballotStatus.schema'
import { buildGetBallotRequirementsTool } from './getBallotRequirements.tool'
import { HelpCenterSearchService } from '../help-center/helpCenterSearch.service'
import { buildSearchHelpCenterTool } from '../help-center/searchHelpCenter.tool'
import { buildComposeHandoffTool } from '../chief-of-staff/services/composeHandoff.tool'
import { areaForPath } from '../product-knowledge/productMap'
import { PriorityFlowOutreachService } from '../priority-flow/services/priorityFlowOutreach.service'
import { buildCampaignManagerReadPastOutreachTool } from '../chat-tools/readPastOutreach.tool'
import { buildCampaignManagerPresentPastOutreachTool } from '../chat-tools/presentPastOutreach.tool'
import { buildAskClarifyQuestionTool } from '../chat-tools/askClarifyQuestion.tool'

// Sensitive scope: the agent is grounded in the candidate's own campaign data,
// so it runs Anthropic-only. The registry fails closed on any non-claude model.
export const CAMPAIGN_MANAGER_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const

// The scripted opener, seeded as each new conversation's first assistant
// message so the agent keeps its own greeting in context on later turns.
// Mirrors buildCampaignManagerIntro in gp-webapp, which plays the same copy
// while the conversation create is still deferred (kept in sync by hand; it is
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
          "Before I build your campaign and outreach plan, let's get your " +
            "Campaign Story down, since it's what personalizes your plan " +
            'and your GoodParty.org experience.',
          "It's just three short questions, in your own words, and I can " +
            'help sharpen anything you write.',
        ]
      : [
          "Welcome back. Let's finish your Campaign Story so I can build " +
            'your campaign and outreach plan.',
        ]
  const lead = answered === 0 ? 'First' : 'Next'
  return [...intro, `${lead}, ${STORY_QUESTION_PROMPTS[next]}`].join('\n\n')
}

// Canned reply for the product-overview sentinel (the "Learn more about the
// product" chip). Independent of the candidate's Campaign Story state, so it
// answers the same way whether the story is missing, in progress, or done.
const CAMPAIGN_MANAGER_PRODUCT_OVERVIEW = [
  "I'm your campaign manager, here to help you run and win.",
  'GoodParty.org gives you a personalized campaign and outreach plan with ' +
    'your highest-impact tasks each week, voter outreach tools like texting, ' +
    'door-knocking scripts, and social posts, and a free candidate website.',
  'Tell me what you are working on and I will point you to the next best ' +
    'step. When you are ready, tap Personalize your campaign and I will ' +
    'tailor everything to your race.',
].join('\n\n')

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

// Native web search only exists when the Anthropic key is configured. Read in
// one place so the prompt's guidance and the tool registration can never
// disagree about whether the manager can search.
const webSearchAvailable = (): boolean => !!process.env.ANTHROPIC_API_KEY

// Live race data is cut once per campaign per local day: the first turn of
// the day fetches it and every later turn that day, in any of the campaign's
// conversations, reuses it. The lookup fans out to election-api and
// BallotReady, so it races a timer and a slow day degrades to "unavailable"
// instead of holding the turn.
const LIVE_RACE_TIMEOUT_MS = 3_000

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms} ms`)),
      ms,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })

const EMPTY_CONTEXT: CampaignManagerContext = {
  candidateFirstName: null,
  candidateName: '',
  campaignId: null,
  officeName: null,
  district: null,
  officeLevel: null,
  location: null,
  electionDate: null,
  primaryElectionDate: null,
  primaryResult: null,
  didWin: null,
  liveRace: { status: 'none', reason: 'no-election-date' },
  ballotStatus: null,
  filingPeriodStart: null,
  filingPeriodEnd: null,
  topTasks: [],
  districtFilters: null,
  constituentToolEnabled: false,
  organization: null,
  crmToolsEnabled: false,
  savedFilterToolsEnabled: false,
  helpCenterToolEnabled: false,
  raceId: null,
  isPro: null,
  // Overridden by the early-return sites below: web search does not depend on
  // the campaign resolving, so a campaign we could not load must not silently
  // lose it.
  webSearchEnabled: false,
  story: null,
  plan: null,
}

@Injectable()
export class CampaignManagerHandler implements ChatScopeHandler<CampaignManagerContext> {
  readonly scope = ChatScope.campaign_assistant
  readonly isSensitive = true
  readonly models = [...CAMPAIGN_MANAGER_MODELS]
  // The default 5 steps ran out mid-outreach: describe, count, size, then
  // save or present is already four tool calls before any retry or search,
  // and a turn that runs out of steps ends without presenting anything.
  readonly maxSteps = 15

  // One entry per campaign: the day it was cut and what came back. Replaced
  // when the campaign's local day moves on; never holds an unavailable
  // outcome, so the next turn after a failure tries again.
  private readonly liveRaceByCampaign = new Map<
    number,
    { day: string; value: LiveRace }
  >()

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
    private readonly storyIntake?: CampaignStoryIntakeService,
    @Optional()
    private readonly contacts?: ContactsService,
    @Optional()
    private readonly voterFileFilters?: VoterFileFilterService,
    @Optional()
    private readonly elections?: ElectionsService,
    @Optional()
    private readonly helpCenter?: HelpCenterSearchService,
    @Optional()
    private readonly pastOutreach?: PriorityFlowOutreachService,
    @Optional()
    private readonly logger?: PinoLogger,
  ) {
    this.logger?.setContext(CampaignManagerHandler.name)
  }

  // The manager runs the shared session model (one fresh conversation per
  // open, resume by opening a past one from history), so it has no
  // resolveConversation of its own — only this hook, which puts the manager's
  // opener at the top of the new transcript. The client plays the same copy
  // while the create is still deferred.
  async seedConversation(
    conversationId: string,
    params: ResolveConversationParams,
  ): Promise<void> {
    const greeting = await this.resolveGreeting(params.organizationSlug)
    await this.chatStore.appendMessage({
      conversationId,
      role: ChatMessageRole.assistant,
      content: greeting,
    })
  }

  // Always the general greeting (Campaign Story intake runs on demand via the
  // kickoff sentinel, not at conversation creation). First-name aware when the
  // campaign's owning user resolves. Best-effort: any lookup miss falls back to
  // the no-name greeting rather than throwing.
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

  private emptyContext(): CampaignManagerContext {
    return {
      ...EMPTY_CONTEXT,
      webSearchEnabled: webSearchAvailable(),
      // Help-center search needs neither a campaign nor a credential, so it
      // survives a context we could not resolve.
      helpCenterToolEnabled: !!this.helpCenter,
    }
  }

  async loadContext(
    conversationId: string,
    userId: number,
  ): Promise<CampaignManagerContext> {
    const conversation = await this.store.findFirst({
      where: { id: conversationId, ownerUserId: userId },
    })
    const organizationSlug = conversation?.organizationSlug
    if (!organizationSlug) return this.emptyContext()

    const campaign = await this.campaigns.client.campaign.findFirst({
      where: { organizationSlug },
      include: { user: true },
    })
    if (!campaign) return this.emptyContext()

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
    const location =
      [details.city, details.state].filter(Boolean).join(', ') || null
    const ballotStatus = parseBallotStatus(campaign.ballotStatus)

    // Scope constituent queries to the campaign's district (from its org's
    // position), same shape Chief of Staff uses. Folding districtFilters into
    // constituentToolEnabled (rather than leaving it a separate buildTools
    // check) keeps prompt advertising and tool registration on one signal,
    // same as crmToolsEnabled/savedFilterToolsEnabled below.
    const resolved =
      await this.districtResolver?.resolveByOrgSlug(organizationSlug)
    const districtFilters =
      resolved && this.districtResolver
        ? this.districtResolver.toMandatoryFilters(resolved)
        : null
    const constituentToolEnabled =
      !!this.constituentProvider &&
      this.constituentTables.length > 0 &&
      districtFilters !== null

    // The org row the CRM contact tools bind counts to. Folding the service
    // presence into crmToolsEnabled keeps prompt advertising and tool
    // registration on one signal; only look up the org when the tools could
    // otherwise register.
    const organization = this.contacts
      ? await this.campaigns.client.organization.findFirst({
          where: { slug: organizationSlug },
        })
      : null
    const crmToolsEnabled = !!this.contacts && !!organization
    // The saved-filter write tool additionally needs VoterFileFilterService;
    // folding its presence in keeps prompt advertising and tool registration
    // on one signal, same as crmToolsEnabled itself.
    const savedFilterToolsEnabled = crmToolsEnabled && !!this.voterFileFilters

    const liveRace = await this.resolveLiveRace(
      campaign,
      localDay(details.state ?? null),
    )

    return {
      candidateFirstName: campaign.user?.firstName ?? null,
      candidateName,
      campaignId: campaign.id,
      officeName: details.normalizedOffice ?? null,
      district: details.district ?? null,
      officeLevel: details.ballotLevel ?? null,
      location,
      state: details.state ?? null,
      // The record as stored. The prompt builder parses and counts from these
      // against the candidate's local day, so an unparseable value reads as no
      // date there rather than becoming NaN here.
      electionDate: details.electionDate ?? null,
      primaryElectionDate: details.primaryElectionDate ?? null,
      primaryResult: campaign.primaryResult ?? null,
      didWin: campaign.didWin ?? null,
      liveRace,
      ballotStatus,
      filingPeriodStart: details.filingPeriodsStart ?? null,
      filingPeriodEnd: details.filingPeriodsEnd ?? null,
      topTasks: selectTopDynamicTasks(tasks).map((t) => ({
        title: t.title,
        date: t.date,
      })),
      districtFilters,
      constituentToolEnabled,
      organization,
      crmToolsEnabled,
      savedFilterToolsEnabled,
      // The same column the contacts service reads before it refuses. That
      // service also treats elected-office organizations as Pro; this handler
      // only ever serves campaigns, so the row alone is the whole rule here.
      isPro: campaign.isPro ?? false,
      raceId: details.raceId ?? null,
      webSearchEnabled: webSearchAvailable(),
      helpCenterToolEnabled: !!this.helpCenter,
      story,
      plan,
    }
  }

  // The record is checked first, as read this turn, so a campaign that gains
  // a race today is looked up today and the two "none" outcomes never cost a
  // call. The service returns a bare null for a missing election date, a
  // missing race, and an upstream failure alike, which is why the checks
  // live here rather than on its result. The trade: its position-based
  // fallback for a campaign without a race hash is skipped, and that path
  // cannot produce dates or windows, only a win number.
  private async resolveLiveRace(
    campaign: Campaign,
    day: string,
  ): Promise<LiveRace> {
    const details = campaign.details
    if (!details.electionDate) {
      return { status: 'none', reason: 'no-election-date' }
    }
    if (!details.raceId) return { status: 'none', reason: 'no-race' }
    const cached = this.liveRaceByCampaign.get(campaign.id)
    if (cached && cached.day === day) return cached.value
    const started = Date.now()
    const value = await this.fetchLiveRace(campaign)
    this.logger?.info(
      {
        campaignId: campaign.id,
        status: value.status,
        ms: Date.now() - started,
      },
      'campaign manager live race data fetched',
    )
    if (value.status === 'ok') {
      this.liveRaceByCampaign.set(campaign.id, { day, value })
    }
    return value
  }

  private async fetchLiveRace(campaign: Campaign): Promise<LiveRace> {
    try {
      const metrics = await withTimeout(
        this.campaigns.fetchLiveRaceTargetMetrics(campaign),
        LIVE_RACE_TIMEOUT_MS,
      )
      if (!metrics) return { status: 'unavailable' }
      const m = metrics.milestones
      return {
        status: 'ok',
        data: {
          generalElectionDate: metrics.generalElectionDate,
          primaryElectionDate: metrics.primaryElectionDate,
          milestones: m
            ? {
                voterRegistration: m.voter_registration,
                earlyVoting: m.early_voting,
                ballotRequest: m.request_ballot,
              }
            : null,
          winNumber: metrics.winNumber,
          voterContactGoal: metrics.voterContactGoal,
        },
      }
    } catch (error) {
      this.logger?.warn(
        { error, campaignId: campaign.id },
        'campaign manager live race data lookup failed',
      )
      return { status: 'unavailable' }
    }
  }

  describePage(pagePath: string): string | null {
    const area = areaForPath('win', pagePath)
    return area ? currentPageBlock(area) : null
  }

  buildSystemPrompt(ctx: CampaignManagerContext): string {
    return buildCampaignManagerSystemPrompt(
      ctx,
      Object.keys(this.buildTools(ctx)),
    )
  }

  buildTools(ctx: CampaignManagerContext): Record<string, LlmTool> {
    const tools: Record<string, LlmTool> = {}

    // Web search runs through Anthropic's native tool (the scope is Claude-only)
    // so queries stay within the enterprise agreement. Registration reads the
    // same ctx flag the prompt's ballot guidance reads, so the prompt can never
    // advertise a search tool that was not registered.
    if (ctx.webSearchEnabled) {
      tools.web_search = { kind: 'native_web_search', maxUses: 5 }
    }

    // Our own published support articles. Needs no credential and no
    // campaign context, so it registers whenever the service is provided.
    if (this.helpCenter && ctx.helpCenterToolEnabled) {
      tools.search_help_center = buildSearchHelpCenterTool({
        helpCenter: this.helpCenter,
      })
    }

    // Aggregate-only constituent data against the dedicated Win mart
    // (sp_win_agent credential + win_agent_voters allowlist + the shared SQL
    // validator + cell-size floor). Registers only when the provider is
    // configured and the campaign's district resolved into server-bound
    // filters — otherwise it stays dark.
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

    // BallotReady filing requirements for the candidate's own race, bound to
    // the campaign's race hash. Registered whenever the race resolved, not
    // gated on ballot status: a candidate who already filed can still ask what
    // their filing office needs, and the prompt decides when to lead with it.
    if (this.elections && ctx.raceId) {
      tools.get_ballot_requirements = buildGetBallotRequirementsTool({
        elections: this.elections,
        raceId: ctx.raceId,
        filingPeriodStart: ctx.filingPeriodStart,
        filingPeriodEnd: ctx.filingPeriodEnd,
      })
    }

    // Compose handoff: drafts a social post for the candidate to review in
    // a prefilled Win social-flow compose drawer.
    tools.compose_handoff = buildComposeHandoffTool('win_social')

    if (this.pastOutreach && ctx.campaignId !== null) {
      tools.read_past_outreach = buildCampaignManagerReadPastOutreachTool({
        outreach: this.pastOutreach,
        campaignId: ctx.campaignId,
      })
      tools.present_past_outreach =
        buildCampaignManagerPresentPastOutreachTool()
    }
    tools.ask_clarify_question = buildAskClarifyQuestionTool()

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

    // A campaign without Pro can still count, size a sample and be shown an
    // outreach card: the count service is open to it (the outreach build path
    // prices a list before the upgrade) and the card's own button takes it
    // to the Pro gate. Only the tools whose services refuse it stay Pro:
    // precincts and saved-list management. Only a known false gates; an
    // unknown flag arises only when no campaign resolved, which turns every
    // one of these off anyway.
    if (this.contacts && ctx.crmToolsEnabled && ctx.organization) {
      const isPro = ctx.isPro !== false
      const filterTools: Record<string, LlmTool> = {}
      filterTools.count_contacts = buildCountContactsTool({
        contacts: this.contacts,
        organization: ctx.organization,
      })
      // Beside describe_filter_dimensions rather than with the saved-list
      // tools: it IS the vocabulary read for the one dimension the catalog
      // cannot carry, and a count is as entitled to a precinct as a saved
      // list is.
      if (isPro) {
        filterTools.list_precincts = buildListPrecinctsTool({
          contacts: this.contacts,
          organization: ctx.organization,
        })
      }
      // Saved-filter CRUD goes through the same VoterFileFilterService
      // paths as the voter-file routes (Pro gate, completed-outreach
      // validation, org scoping, locked-filter conflict all inherited).
      if (isPro && this.voterFileFilters && ctx.savedFilterToolsEnabled) {
        filterTools.crud_saved_filters = buildCrudSavedFiltersTool({
          voterFileFilters: this.voterFileFilters,
          contacts: this.contacts,
          organization: ctx.organization,
        })
        // With the saved-list tool, as on the Chief of Staff: the only id
        // it can be given is one crud_saved_filters returned.
        filterTools.show_list_map = buildShowListMapTool()
      }
      // Saved through the same voter-file route the outreach cards use,
      // which a free campaign can reach; the card's button holds the Pro
      // gate.
      if (this.voterFileFilters && ctx.savedFilterToolsEnabled) {
        filterTools.present_list_proposal =
          buildCampaignManagerListProposalTool()
      }
      // The catalog is built over the filter tools so its description names
      // only the ones registered beside it. It is still listed first, as it
      // always was.
      tools.describe_filter_dimensions = buildDescribeFilterDimensionsTool({
        contacts: this.contacts,
        organization: ctx.organization,
        filterConsumers: registeredFilterConsumers(filterTools),
      })
      Object.assign(tools, filterTools)
      // The card's flows save the list through the voter-file route,
      // which a free campaign can use too, so this follows the saved-list
      // signal rather than the Pro-only tool.
      if (this.voterFileFilters && ctx.savedFilterToolsEnabled) {
        tools.size_outreach_sample = buildSizeOutreachSampleTool()
        tools.present_outreach_proposal =
          buildCampaignManagerOutreachProposalTool()
      }
    }

    return tools
  }

  // The prompt's legal-and-compliance rules carry the caution. The shared
  // finish-time check decides whether a reply is shaped like legal advice (a
  // statute citation, liability language, complaint filing) and carries no
  // caution; when it is, the candidate gets the same line the prompt asks
  // for, so the wording does not depend on which path supplied it.
  finalizeAssistantText(text: string): string | null {
    return professionalAdviceDisclaimer(text) === null
      ? null
      : `\n\n${LEGAL_LINE}`
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

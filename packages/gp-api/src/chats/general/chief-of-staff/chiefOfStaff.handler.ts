import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { ChatScope } from '../../../generated/prisma'
import type { LlmTool } from '@/llm/services/llm.service'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import {
  buildDescribeConstituentDataTool,
  buildQueryConstituentDataTool,
} from '@/llm/tools/queryConstituentData.tool'
import { ChatScopeHandler } from '../types/chatScopeHandler'
import {
  ChiefOfStaffContext,
  ChiefOfStaffContextService,
} from './services/chiefOfStaffContext.service'
import { ChiefOfStaffBriefingsService } from './services/chiefOfStaffBriefings.service'
import { buildChiefOfStaffSystemPrompt } from './services/chiefOfStaffPrompt'
import {
  composeAppendix,
  handoffDraftBackstop,
  legalAdviceBackstop,
  smallCountBackstop,
} from '../services/guardrailBackstops'
import {
  ADVICE_SIGNALS,
  SECTION_MARK_SIGNAL,
} from '../services/professionalAdviceCheck'
import type { FinalizeTurn } from '@/chats/services/chatStream.service'
import {
  buildConstituentDataScope,
  ConstituentTablesByDataset,
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
import { buildComposeHandoffTool } from './services/composeHandoff.tool'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  buildDescribeFilterDimensionsTool,
  registeredFilterConsumers,
} from '../crm-tools/describeFilterDimensions.tool'
import { buildCountContactsTool } from '../crm-tools/countContacts.tool'
import { buildCrudSavedFiltersTool } from '../crm-tools/crudSavedFilters.tool'
import { buildShowListMapTool } from '../crm-tools/showListMap.tool'
import { buildPresentListProposalTool } from '../crm-tools/presentListProposal.tool'
import { buildListPrecinctsTool } from '../crm-tools/listPrecincts.tool'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { HelpCenterSearchService } from '../help-center/helpCenterSearch.service'
import { buildSearchHelpCenterTool } from '../help-center/searchHelpCenter.tool'
import { buildAskClarifyQuestionTool } from '../chat-tools/askClarifyQuestion.tool'
import { buildPresentOutsideContactTool } from '../chat-tools/presentOutsideContact.tool'
import { buildPresentOutreachProposalTool } from '../chat-tools/presentOutreachProposal.tool'
import { buildPresentPastOutreachTool } from '../chat-tools/presentPastOutreach.tool'
import { buildReadPastOutreachTool } from '../chat-tools/readPastOutreach.tool'
import { buildReadOutreachFeedbackTool } from '../chat-tools/readOutreachFeedback.tool'
import { FeaturesService } from '@/features/services/features.service'
import { OutreachReportBackService } from '@/outreach/services/outreachReportBack.service'
import { ManagedCivicPanelService } from '@/contacts/services/managedCivicPanel.service'
import { CivicPanelReachService } from '@/contacts/services/civicPanelReach.service'
import {
  buildManagedCivicPanelTools,
  isManagedPanelSetUp,
} from './services/managedCivicPanel.tools'
import { SERVE_CITIZEN_PANELS_FLAG } from '@/shared/util/serveCitizenPanelsFlag.util'
import { PriorityResultsService } from '@/priorities/services/priorityResults.service'
import { buildSizeOutreachSampleTool } from '../chat-tools/sizeOutreachSample.tool'
import { PriorityFlowOutreachService } from '../priority-flow/services/priorityFlowOutreach.service'
import { resolveSendWindowTimeZone } from '@/vendors/peerly/utils/sendWindowTimeZone.util'
import { PriorityStatusService } from '@/priorities/services/priorityStatus.service'
import { PeopleDatasetService } from '@/peopleDb/services/peopleDataset.service'

// Sensitive scope: tool outputs (briefings, priorities, search results) flow
// back into the model context, so this scope runs Anthropic-only. The registry
// fails closed if any of these is not claude-routed.
const COS_LEGAL_SIGNALS = ADVICE_SIGNALS.filter(
  (re) => re !== SECTION_MARK_SIGNAL,
)

export const CHIEF_OF_STAFF_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const

// Token for the aggregate-only Databricks provider. Bound to a factory that
// reads the SAME shared DATABRICKS_* credential the briefing chat uses, so the
// tool stays unregistered until that key is configured.
export const CONSTITUENT_DATA_PROVIDER = 'CONSTITUENT_DATA_PROVIDER'

// Token for the app-layer table/dimension allowlist (lever 1), keyed by people
// dataset. Injected so prod uses the in-code CONSTITUENT_TABLES_BY_DATASET
// const while tests can supply a fixture.
export const CONSTITUENT_TABLES_CONFIG = 'CONSTITUENT_TABLES_CONFIG'

@Injectable()
export class ChiefOfStaffHandler implements ChatScopeHandler<ChiefOfStaffContext> {
  readonly scope = ChatScope.chief_of_staff
  readonly isSensitive = true
  readonly models = [...CHIEF_OF_STAFF_MODELS]
  // The default 5 steps ran out mid-outreach: describe, count, size, then
  // save or present is already four tool calls before any retry or search,
  // and a turn that runs out of steps ends without presenting anything.
  readonly maxSteps = 15
  private readonly logger = new Logger(ChiefOfStaffHandler.name)

  constructor(
    private readonly contextService: ChiefOfStaffContextService,
    private readonly briefings: ChiefOfStaffBriefingsService,
    @Inject(PRIORITIES_PORT)
    private readonly priorities: PrioritiesToolPort,
    @Inject(CONSTITUENT_TABLES_CONFIG)
    private readonly constituentTables: ConstituentTablesByDataset,
    @Optional()
    @Inject(CONSTITUENT_DATA_PROVIDER)
    private readonly constituentProvider?: DatabricksProvider,
    @Optional()
    private readonly districtResolver?: DistrictResolverService,
    @Optional()
    @Inject(COMMUNITY_ISSUE_READ_PORT)
    private readonly communityIssueRead?: CommunityIssueReadPort,
    @Optional()
    private readonly contacts?: ContactsService,
    @Optional()
    private readonly voterFileFilters?: VoterFileFilterService,
    @Optional()
    private readonly helpCenter?: HelpCenterSearchService,
    @Optional()
    private readonly pastOutreach?: PriorityFlowOutreachService,
    @Optional()
    private readonly priorityStatus?: PriorityStatusService,
    @Optional()
    private readonly peopleDatasets?: PeopleDatasetService,
    @Optional()
    private readonly features?: FeaturesService,
    @Optional()
    private readonly reportBack?: OutreachReportBackService,
    @Optional()
    private readonly priorityResults?: PriorityResultsService,
    @Optional()
    private readonly managedPanels?: ManagedCivicPanelService,
    @Optional()
    private readonly civicPanelReach?: CivicPanelReachService,
  ) {}

  async loadContext(
    conversationId: string,
    userId: number,
  ): Promise<ChiefOfStaffContext> {
    const ctx = await this.contextService.load(
      conversationId,
      userId,
      this.priorities,
    )
    // Resolve by the conversation's org slug, not the user: an official with
    // offices in multiple orgs would otherwise get whichever ElectedOffice row
    // came back first, scoping constituent data to another org's district.
    // ctx.organizationSlug is never a guess: load() matches the office on the
    // conversation's own slug and throws when a conversation has none.
    const resolved = await this.districtResolver?.resolveByOrgSlug(
      ctx.organizationSlug,
    )
    // Once per turn, so every constituent-data call in it reads one table.
    // Resolved before the district check because the CRM tools register
    // without a district and describe the same dataset.
    const peopleDataset = this.peopleDatasets
      ? await this.peopleDatasets.resolve(ctx.organization)
      : { base: 'voters' as const }
    const outreachFeedbackEnabled = this.features
      ? await this.features.isFeatureEnabled({
          user: userId,
          feature: SERVE_CITIZEN_PANELS_FLAG,
        })
      : false
    const managedPanel = outreachFeedbackEnabled
      ? await this.readManagedPanel(ctx.organization)
      : undefined
    const reportBacks =
      outreachFeedbackEnabled && this.reportBack
        ? await this.reportBack.listForOffice(
            ctx.organizationSlug,
            ctx.electedOfficeId,
          )
        : undefined
    const priorityReads =
      outreachFeedbackEnabled && this.priorityResults
        ? await this.priorityResults.readStatuses(
            ctx.organizationSlug,
            ctx.priorities.map((priority) => priority.id),
          )
        : undefined
    if (!resolved) {
      return {
        ...ctx,
        peopleDataset,
        outreachFeedbackEnabled,
        managedPanel,
        reportBacks,
        priorityReads,
      }
    }
    const districtFilters = this.districtResolver
      ? this.districtResolver.toMandatoryFilters(resolved)
      : null
    const constituentToolEnabled =
      !!this.constituentProvider &&
      this.constituentTables[peopleDataset.base].length > 0
    return {
      ...ctx,
      outreachFeedbackEnabled,
      managedPanel,
      reportBacks,
      priorityReads,
      jurisdiction: `${resolved.l2DistrictName}, ${resolved.state}`,
      state: resolved.state,
      districtFilters,
      constituentToolEnabled,
      peopleDataset,
    }
  }

  // Undefined where the managed panel is not wired in, which keeps the
  // do-it-yourself plan; null before the office approves one. A failed read
  // is treated as not set up, so the turn still runs.
  private async readManagedPanel(
    organization: ChiefOfStaffContext['organization'],
  ): Promise<ChiefOfStaffContext['managedPanel']> {
    if (!this.managedPanels) return undefined
    try {
      return (await this.managedPanels.read(organization)).panel
    } catch (err) {
      this.logger.warn(
        `managed civic panel read failed for ${organization.slug}: ${String(err)}`,
      )
      return null
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

  // Finish-time backstops for the lines the prompt asks for. The bare section
  // sign is left out of the legal signals, as the briefing chat does: this
  // chat summarizes the same agendas and briefings, where a section number in
  // a summary is not a legal reading. The small-count and handoff lines are
  // decided from the turn's tool events, not the text.
  finalizeAssistantText(text: string, turn: FinalizeTurn): string | null {
    return composeAppendix([
      legalAdviceBackstop(text, 'chief_of_staff', COS_LEGAL_SIGNALS),
      smallCountBackstop(text, 'chief_of_staff', turn.toolEvents),
      handoffDraftBackstop(text, 'chief_of_staff', turn.toolEvents),
    ])
  }

  private assembleTools(ctx: ChiefOfStaffContext): Record<string, LlmTool> {
    const tools: Record<string, LlmTool> = {}

    tools.crud_priorities = buildCrudPrioritiesTool({
      port: this.priorities,
      electedOfficeId: ctx.electedOfficeId,
    })

    // Registered only when a priority has a check the official put off, so
    // the prompt never offers a write with nothing to write to.
    const hasDeferredCheck = ctx.priorities.some((priority) =>
      priority.flow?.checks.some(
        ({ check }) =>
          check.state === 'deferred' || check.contrast?.state === 'deferred',
      ),
    )
    if (this.priorityStatus && hasDeferredCheck) {
      Object.assign(
        tools,
        this.priorityStatus.buildCheckReminderTool(ctx.electedOfficeId),
      )
    }

    const briefingProvider = this.briefings.forElectedOffice(
      ctx.electedOfficeId,
    )
    tools.list_briefings = buildListBriefingsTool({
      provider: briefingProvider,
    })
    tools.get_briefing = buildGetBriefingTool({ provider: briefingProvider })

    tools.ask_clarify_question = buildAskClarifyQuestionTool()

    // Web search runs through Anthropic's native tool (the chat is Claude-only)
    // so queries stay within the enterprise agreement rather than going to a
    // third party. Gated on the key here too (not just in the LLM layer) so the
    // system prompt never advertises a tool that wasn't registered.
    if (process.env.ANTHROPIC_API_KEY) {
      tools.web_search = { kind: 'native_web_search', maxUses: 5 }
      // An outside contact is built only from what research found, and the
      // tool forbids inventing a route, so it has nothing to stand on without
      // the search.
      tools.present_outside_contact = buildPresentOutsideContactTool()
    }

    // Aggregate-only constituent data. Registers ONLY when all of: the provider
    // is configured (shared DATABRICKS_* present), the user's district resolved
    // into server-bound filters, and an approved table is in the in-code
    // allowlist. Any one missing keeps the tool off.
    if (
      this.constituentProvider &&
      ctx.districtFilters &&
      ctx.constituentToolEnabled
    ) {
      const scope = buildConstituentDataScope(
        ctx.districtFilters,
        this.constituentTables[ctx.peopleDataset.base],
        ctx.peopleDataset,
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

    // Our own published support articles. Needs no credential and no org
    // context, so it registers whenever the service is provided.
    if (this.helpCenter) {
      tools.search_help_center = buildSearchHelpCenterTool({
        helpCenter: this.helpCenter,
      })
    }

    // No priority here, so the read returns the office's recent sends only.
    if (this.pastOutreach) {
      tools.read_past_outreach = buildReadPastOutreachTool({
        outreach: this.pastOutreach,
        priorityId: null,
        organizationSlug: ctx.organizationSlug,
        timeZone: resolveSendWindowTimeZone(ctx.state),
      })
      if (ctx.outreachFeedbackEnabled) {
        tools.read_outreach_feedback = buildReadOutreachFeedbackTool({
          outreach: this.pastOutreach,
          priorityId: null,
          organizationSlug: ctx.organizationSlug,
          timeZone: resolveSendWindowTimeZone(ctx.state),
        })
      }
      tools.present_past_outreach = buildPresentPastOutreachTool()
    }

    if (this.communityIssueRead) {
      tools.read_community_issues = buildReadCommunityIssuesTool({
        port: this.communityIssueRead,
        organizationSlug: ctx.organizationSlug,
        electedOfficeId: ctx.electedOfficeId,
      })
    }

    // Aggregate-only CRM reads (describe dimensions + count), unconditional
    // for Serve once the contacts service resolves. The org is bound from
    // the resolved context; ContactsService enforces the Serve party
    // rejection and every other filter rule.
    if (this.contacts) {
      const crmTools: Record<string, LlmTool> = {}
      crmTools.count_contacts = buildCountContactsTool({
        contacts: this.contacts,
        organization: ctx.organization,
        peopleDataset: ctx.peopleDataset,
      })
      // Beside describe_filter_dimensions rather than with the saved-list
      // tools: it IS the vocabulary read for the one dimension the catalog
      // cannot carry, and a count is as entitled to a precinct as a saved
      // list is.
      crmTools.list_precincts = buildListPrecinctsTool({
        contacts: this.contacts,
        organization: ctx.organization,
      })
      // Saved-filter CRUD goes through the same VoterFileFilterService paths
      // as the voter-file routes (completed-outreach validation, org scoping,
      // locked-filter conflict all inherited). The prompt rules key off the
      // registered tool name.
      if (this.voterFileFilters) {
        crmTools.crud_saved_filters = buildCrudSavedFiltersTool({
          voterFileFilters: this.voterFileFilters,
          contacts: this.contacts,
          organization: ctx.organization,
          peopleDataset: ctx.peopleDataset,
        })
        // Registered with the saved-list tool rather than beside the other
        // reads: the only id it can legitimately be given is one
        // crud_saved_filters just returned, so advertising it in a session
        // that cannot create a list would be offering a map of nothing.
        crmTools.show_list_map = buildShowListMapTool()
        // How a list gets saved from here: as a card the official presses,
        // not a write the model makes after a typed "yes".
        crmTools.present_list_proposal = buildPresentListProposalTool()
      }
      // The catalog is built over the other CRM tools so its description
      // names only the filter tools registered beside it, and is still
      // listed first, as it always was.
      tools.describe_filter_dimensions = buildDescribeFilterDimensionsTool({
        contacts: this.contacts,
        organization: ctx.organization,
        filterConsumers: registeredFilterConsumers(crmTools),
        peopleDataset: ctx.peopleDataset,
        citizenPanels: ctx.outreachFeedbackEnabled === true,
        state: ctx.state,
      })
      Object.assign(tools, crmTools)
      // A proposal is sent against a saved list, so it is offered only where
      // the list behind it can be built.
      if (this.voterFileFilters) {
        tools.present_outreach_proposal = buildPresentOutreachProposalTool()
        tools.size_outreach_sample = buildSizeOutreachSampleTool()
      }
    }

    // GoodParty builds the panel (the managed panel), behind
    // serve-citizen-panels. It replaces the do-it-yourself plan, whose tools
    // stay only for an office already part way through one.
    if (ctx.managedPanel !== undefined && this.managedPanels) {
      Object.assign(
        tools,
        buildManagedCivicPanelTools({
          panels: this.managedPanels,
          reach: this.civicPanelReach,
          organization: ctx.organization,
          setUp: isManagedPanelSetUp(ctx.managedPanel),
        }),
      )
    }
    tools.compose_handoff = buildComposeHandoffTool('serve_social')

    return tools
  }
}

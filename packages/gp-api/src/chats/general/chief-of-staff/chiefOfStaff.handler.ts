import { Inject, Injectable, Optional } from '@nestjs/common'
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
import { professionalAdviceDisclaimer } from '../services/professionalAdviceCheck'
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
import { buildSizeOutreachSampleTool } from '../chat-tools/sizeOutreachSample.tool'
import { PriorityFlowOutreachService } from '../priority-flow/services/priorityFlowOutreach.service'
import { PriorityStatusService } from '@/priorities/services/priorityStatus.service'

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

@Injectable()
export class ChiefOfStaffHandler implements ChatScopeHandler<ChiefOfStaffContext> {
  readonly scope = ChatScope.chief_of_staff
  readonly isSensitive = true
  readonly models = [...CHIEF_OF_STAFF_MODELS]

  constructor(
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
    if (!resolved) return ctx
    const districtFilters = this.districtResolver
      ? this.districtResolver.toMandatoryFilters(resolved)
      : null
    const constituentToolEnabled =
      !!this.constituentProvider && this.constituentTables.length > 0
    return {
      ...ctx,
      jurisdiction: `${resolved.l2DistrictName}, ${resolved.state}`,
      state: resolved.state,
      districtFilters,
      constituentToolEnabled,
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
      })
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
      })
      Object.assign(tools, crmTools)
      // A proposal is sent against a saved list, so it is offered only where
      // the list behind it can be built.
      if (this.voterFileFilters) {
        tools.present_outreach_proposal = buildPresentOutreachProposalTool()
        tools.size_outreach_sample = buildSizeOutreachSampleTool()
      }
    }

    tools.compose_handoff = buildComposeHandoffTool('serve_social')

    return tools
  }
}

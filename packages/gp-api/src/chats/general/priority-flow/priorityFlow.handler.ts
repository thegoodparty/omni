import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common'
import { formatISO } from 'date-fns'
import {
  checkSmsStandards,
  OrdinanceAuthorityFindingSchema,
  OrdinanceCurrentLawSummarySchema,
  OrdinancePresentComparablesSchema,
  type ProposalChannel,
} from '@goodparty_org/contracts'
import { ChatScope } from '../../../generated/prisma'
import type { LlmStreamTool, LlmTool } from '@/llm/services/llm.service'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import {
  buildDescribeConstituentDataTool,
  buildQueryConstituentDataTool,
} from '@/llm/tools/queryConstituentData.tool'
import { PriorityStatusService } from '@/priorities/services/priorityStatus.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { PeopleDatasetService } from '@/peopleDb/services/peopleDataset.service'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import {
  ChatScopeHandler,
  ResolveConversationParams,
  ResolveConversationResult,
} from '../types/chatScopeHandler'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import { professionalAdviceDisclaimer } from '../services/professionalAdviceCheck'
import {
  buildConstituentDataScope,
  ConstituentTablesByDataset,
} from '../chief-of-staff/services/constituentDataScope'
import {
  CONSTITUENT_DATA_PROVIDER,
  CONSTITUENT_TABLES_CONFIG,
} from '../chief-of-staff/chiefOfStaff.handler'
import {
  COMMUNITY_ISSUE_READ_PORT,
  CommunityIssueReadPort,
} from '../chief-of-staff/services/communityIssueRead.port'
import { buildReadCommunityIssuesTool } from '../chief-of-staff/services/communityIssueRead.tool'
import {
  buildDescribeFilterDimensionsTool,
  registeredFilterConsumers,
} from '../crm-tools/describeFilterDimensions.tool'
import { buildCountContactsTool } from '../crm-tools/countContacts.tool'
import { buildListPrecinctsTool } from '../crm-tools/listPrecincts.tool'
import { buildCrudSavedFiltersTool } from '../crm-tools/crudSavedFilters.tool'
import { buildAskClarifyQuestionTool } from '../chat-tools/askClarifyQuestion.tool'
import { buildPresentOutsideContactTool } from '../chat-tools/presentOutsideContact.tool'
import {
  buildPriorityOutreachProposalTool,
  checkProposalRefusal,
  proposalResult,
} from '../chat-tools/presentOutreachProposal.tool'
import { buildPresentPastOutreachTool } from '../chat-tools/presentPastOutreach.tool'
import { buildSizeOutreachSampleTool } from '../chat-tools/sizeOutreachSample.tool'
import { buildReadPastOutreachTool } from '../chat-tools/readPastOutreach.tool'
import {
  PriorityFlowContext,
  PriorityFlowContextService,
} from './services/priorityFlowContext.service'
import { PriorityFlowOutreachService } from './services/priorityFlowOutreach.service'
import { buildPriorityFlowSystemPrompt } from './priorityFlow.prompt'

// Sensitive scope: the priority, its status, constituent counts and past
// outreach all flow into the model context, so it runs Anthropic-only. The
// registry fails closed if any of these is not claude-routed.
export const PRIORITY_FLOW_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const

// Every draft goes out under the official's name, and the drawer refuses one
// that does not carry it, so a card that lands there with a placeholder or an
// unsigned text opens on an error. Text and phone scripts are spoken as the
// official, or on their behalf; social and door knocking are not checked.
const PLACEHOLDER = /\[[^\]\n]{1,40}\]/

const unsignedDraftReason = (
  input: { channel: ProposalChannel; message: string },
  firstName: string | null,
): string | null => {
  if (PLACEHOLDER.test(input.message)) {
    return (
      'The message has a placeholder in brackets. Write it out in full, ' +
      "signed with the official's first name and office from <priority>."
    )
  }
  const voiced = input.channel === 'text' || input.channel === 'phoneBanking'
  if (!voiced || firstName === null) return null
  const { failures } = checkSmsStandards(input.message, {
    candidateNames: [firstName],
  })
  if (!failures.includes('candidate_name')) return null
  // A caller may be a volunteer, so the script names the official without
  // claiming to be them.
  return input.channel === 'text'
    ? `A text has to name the official. Open it with "this is ` +
        `${firstName}, your" and their office (no greeting, the flow adds ` +
        `one), then present it again.`
    : `A phone script has to name the official. Have the caller say who ` +
        `they are calling for: "${firstName}, your" and their office.`
}

@Injectable()
export class PriorityFlowHandler implements ChatScopeHandler<PriorityFlowContext> {
  readonly scope = ChatScope.priority_flow
  readonly isSensitive = true
  readonly models = [...PRIORITY_FLOW_MODELS]
  // Same per-turn budget as the ordinance flow, for the same reason: a single
  // turn can chain describe_filter_dimensions, several count_contacts rounds,
  // read_past_outreach, web_search and then a present_* card, and a turn that
  // exhausts its budget mid-research never presents anything.
  readonly maxSteps = 30

  constructor(
    private readonly store: GeneralChatStoreService,
    private readonly contextService: PriorityFlowContextService,
    private readonly outreach: PriorityFlowOutreachService,
    private readonly priorityStatus: PriorityStatusService,
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
    private readonly peopleDatasets?: PeopleDatasetService,
  ) {}

  // ONE conversation per priority, for the life of the priority. The ordinance
  // flow keys a thread to an (ordinance, step) because each of its steps is a
  // separate page; here the seven steps are state on the Priority record and
  // the official works them in whatever order the conversation takes, so
  // splitting the thread per step would throw away exactly the history that
  // makes moving a step back possible. Best-effort find-or-create, matching
  // the other anchored scopes: a concurrent double-open can race to two
  // threads, which is harmless since resume picks the newest.
  async resolveConversation(
    params: ResolveConversationParams,
    userId: number,
  ): Promise<ResolveConversationResult> {
    const anchor = params.anchor
    if (!anchor || anchor.resourceType !== 'priority') {
      throw new BadRequestException('priority_flow requires a priority anchor')
    }

    const candidates = await this.store.findByAnchorResource({
      ownerUserId: userId,
      organizationSlug: params.organizationSlug,
      scope: ChatScope.priority_flow,
      resourceId: anchor.resourceId,
    })
    const [existing] = candidates
    if (existing) {
      return { conversationId: existing.id, created: false }
    }

    await this.contextService.assertPriorityOwnership(
      anchor.resourceId,
      userId,
      params.organizationSlug ?? '',
    )

    const created = await this.store.createScopedConversation({
      ownerUserId: userId,
      organizationSlug: params.organizationSlug,
      scope: ChatScope.priority_flow,
      anchor,
      title: anchor.snapshot.title,
    })
    return { conversationId: created.id, created: true }
  }

  async loadContext(
    conversationId: string,
    userId: number,
  ): Promise<PriorityFlowContext> {
    const ctx = await this.contextService.load(conversationId, userId)
    // Resolve by the conversation's org slug, not the user: an official with
    // offices in multiple orgs would otherwise get the wrong jurisdiction.
    const resolved = await this.districtResolver?.resolveByOrgSlug(
      ctx.organizationSlug,
    )
    // Once per turn, so every constituent-data call in it reads one table.
    // Resolved before the district check because the CRM tools register
    // without a district and describe the same dataset.
    const peopleDataset = this.peopleDatasets
      ? await this.peopleDatasets.resolve(ctx.organization)
      : 'voters'
    if (!resolved) return { ...ctx, peopleDataset }
    return {
      ...ctx,
      jurisdiction: `${resolved.l2DistrictName}, ${resolved.state}`,
      state: resolved.state,
      districtFilters: this.districtResolver
        ? this.districtResolver.toMandatoryFilters(resolved)
        : null,
      constituentToolEnabled:
        !!this.constituentProvider &&
        this.constituentTables[peopleDataset].length > 0,
      peopleDataset,
    }
  }

  buildSystemPrompt(ctx: PriorityFlowContext): string {
    return buildPriorityFlowSystemPrompt({
      ctx,
      toolNames: Object.keys(this.assembleTools(ctx)),
    })
  }

  // Legal readings (a statute cited, liability characterized) get the same
  // deterministic disclaimer backstop Chief of Staff uses.
  finalizeAssistantText(text: string): string | null {
    return professionalAdviceDisclaimer(text)
  }

  buildTools(ctx: PriorityFlowContext): Record<string, LlmTool> {
    return this.assembleTools(ctx)
  }

  private assembleTools(ctx: PriorityFlowContext): Record<string, LlmTool> {
    // Tools are built once per turn, so this flag is "did a card or a question
    // reach the official in this turn". The status tool refuses to record a
    // check as asked until one has, which is what makes `asked` mean shown.
    let offeredThisTurn = false
    const ask = buildAskClarifyQuestionTool()
    const propose = buildPriorityOutreachProposalTool()
    const tools: Record<string, LlmTool> = {
      ...this.priorityStatus.buildStatusTool(ctx.priorityId, {
        offered: () => offeredThisTurn,
        startedAt: formatISO(new Date()),
      }),
      // The answer comes back as an ordinary user turn, so this presents a
      // decision without touching the seven-step status. The agent still
      // decides on its own when a step settles.
      ask_clarify_question: {
        ...ask,
        execute: async (input: Parameters<typeof ask.execute>[0]) => {
          const result = await ask.execute(input)
          if (
            !(
              typeof result === 'object' &&
              result !== null &&
              'error' in result
            )
          ) {
            offeredThisTurn = true
          }
          return result
        },
      },
      present_outreach_proposal: {
        ...propose,
        execute: async (input: Parameters<typeof propose.execute>[0]) => {
          const unsigned = unsignedDraftReason(input, ctx.officialFirstName)
          if (unsigned !== null) return { error: unsigned }
          const widens = input.widensOutreachIds ?? []
          const refusal =
            input.stepId === undefined && input.side === undefined
              ? null
              : checkProposalRefusal(
                  input,
                  await this.priorityStatus.read(ctx.priorityId),
                  widens.length > 0 &&
                    input.stepId !== undefined &&
                    input.side !== undefined &&
                    (await this.outreach.allPutOutCheck(
                      ctx.priorityId,
                      input.stepId,
                      input.side,
                      widens,
                    )),
                )
          if (refusal !== null) return { error: refusal }
          const result = proposalResult(input)
          if (!('error' in result)) offeredThisTurn = true
          return result
        },
      },
      present_outside_contact: buildPresentOutsideContactTool(),
      // The ordinance chat's finding cards, display-only here: a priority has
      // no ordinance to save them to, so they render from their args alone.
      present_comparables: {
        description:
          'Show how other places handled this, as cards: each with city, ' +
          'state, status (passed/repealed/unknown), a quote, and a source ' +
          'you actually found. Put the framing intro and the takeaway in ' +
          'this payload, not as separate chat text.',
        inputSchema: OrdinancePresentComparablesSchema,
        execute: () => ({ presented: true }),
      } satisfies LlmStreamTool<typeof OrdinancePresentComparablesSchema>,
      present_current_law_summary: {
        description:
          "Show what the city's current code or program does today " +
          '(`does`) and where it falls short on this priority (`gaps`), with ' +
          'the chapter or program name and a source you actually read.',
        inputSchema: OrdinanceCurrentLawSummarySchema,
        execute: () => ({ presented: true }),
      } satisfies LlmStreamTool<typeof OrdinanceCurrentLawSummarySchema>,
      present_authority_finding: {
        description:
          'Show whether this office can act on it as a card: a headline, ' +
          'the status (pass/flag/attention), an explanation that cites the ' +
          'statute or charter provision, and its source. A likely reading, ' +
          'never settled law.',
        inputSchema: OrdinanceAuthorityFindingSchema,
        execute: () => ({ presented: true }),
      } satisfies LlmStreamTool<typeof OrdinanceAuthorityFindingSchema>,
      present_past_outreach: buildPresentPastOutreachTool(),
      size_outreach_sample: buildSizeOutreachSampleTool(),
      read_past_outreach: buildReadPastOutreachTool({
        outreach: this.outreach,
        priorityId: ctx.priorityId,
        organizationSlug: ctx.organizationSlug,
      }),
    }

    // Web search runs through Anthropic's native tool (the scope is
    // Claude-only) so queries stay within the enterprise agreement. Gated on
    // the key here so the prompt never advertises an unregistered tool.
    if (process.env.ANTHROPIC_API_KEY) {
      tools.web_search = { kind: 'native_web_search', maxUses: 5 }
    }

    if (
      this.constituentProvider &&
      ctx.districtFilters &&
      ctx.constituentToolEnabled
    ) {
      const scope = buildConstituentDataScope(
        ctx.districtFilters,
        this.constituentTables[ctx.peopleDataset],
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

    if (this.communityIssueRead) {
      tools.read_community_issues = buildReadCommunityIssuesTool({
        port: this.communityIssueRead,
        organizationSlug: ctx.organizationSlug,
        electedOfficeId: ctx.electedOfficeId,
      })
    }

    if (this.contacts) {
      const crmTools: Record<string, LlmTool> = {}
      crmTools.count_contacts = buildCountContactsTool({
        contacts: this.contacts,
        organization: ctx.organization,
        peopleDataset: ctx.peopleDataset,
      })
      // A stage-gate check is often a few blocks, and precinct is the one
      // geographic filter describe_filter_dimensions cannot list.
      crmTools.list_precincts = buildListPrecinctsTool({
        contacts: this.contacts,
        organization: ctx.organization,
      })
      if (this.voterFileFilters) {
        crmTools.crud_saved_filters = buildCrudSavedFiltersTool({
          voterFileFilters: this.voterFileFilters,
          contacts: this.contacts,
          organization: ctx.organization,
          peopleDataset: ctx.peopleDataset,
        })
      }
      tools.describe_filter_dimensions = buildDescribeFilterDimensionsTool({
        contacts: this.contacts,
        organization: ctx.organization,
        filterConsumers: registeredFilterConsumers(crmTools),
        peopleDataset: ctx.peopleDataset,
      })
      Object.assign(tools, crmTools)
    }

    return tools
  }
}

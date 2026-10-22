import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { asSchema } from 'ai'
import { ChatScope } from '../../../generated/prisma'
import {
  CHIEF_OF_STAFF_MODELS,
  ChiefOfStaffHandler,
} from './chiefOfStaff.handler'
import { ChiefOfStaffContextService } from './services/chiefOfStaffContext.service'
import { ChiefOfStaffBriefingsService } from './services/chiefOfStaffBriefings.service'
import {
  PrioritiesToolPort,
  type PriorityRecord,
} from './services/prioritiesPort'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { DATA_SOURCE_ROUTING_RULES } from '@/llm/tools/dataSourceRouting'
import type { LlmTool } from '@/llm/services/llm.service'
import { InMemoryDatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import type { CommunityIssueReadPort } from './services/communityIssueRead.port'
import type { Organization } from '../../../generated/prisma'
import type { ContactsService } from '@/contacts/services/contacts.service'
import type { HelpCenterSearchService } from '../help-center/helpCenterSearch.service'
import type { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { buildComposeHandoffTool } from './services/composeHandoff.tool'
import { guardrailLine } from '../services/guardrailLines'
import { buildPresentOutreachProposalTool } from '../chat-tools/presentOutreachProposal.tool'
import type { PriorityFlowOutreachService } from '../priority-flow/services/priorityFlowOutreach.service'
import type { PriorityStatusService } from '@/priorities/services/priorityStatus.service'
import type { CivicPanelBuildPlanService } from '@/contacts/services/civicPanelBuildPlan.service'
import {
  BUILD_CITIZENS_PANEL_MESSAGE,
  EXPLAIN_CIVIC_PANEL_MESSAGE,
} from '@goodparty_org/contracts'
import type { PriorityResultsService } from '@/priorities/services/priorityResults.service'

// Native web search has no description; every other registered tool does.
const descriptionOf = (tool: LlmTool | undefined): string => {
  if (!tool || !('description' in tool)) {
    throw new Error('expected a tool with a description')
  }
  return tool.description
}

const USER_ID = 7
const ORG = 'eo-123'

const buildPort = (): PrioritiesToolPort => ({
  listActive: vi.fn(() => Promise.resolve([])),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
})

const buildBriefings = (): ChiefOfStaffBriefingsService =>
  ({
    forElectedOffice: vi.fn(() => ({
      list: vi.fn(() => Promise.resolve([])),
      getByDate: vi.fn(() => Promise.resolve(null)),
    })),
  }) as unknown as ChiefOfStaffBriefingsService

const TEST_TABLES = {
  voters: [
    { table: 'constituent_aggregates', dimensions: ['age_band', 'gender'] },
  ],
  constituents: [
    { table: 'constituent_aggregates_all', dimensions: ['age_band', 'gender'] },
  ],
}

const NO_TABLES = { voters: [], constituents: [] }

describe('ChiefOfStaffHandler', () => {
  let context: ChiefOfStaffContextService
  let port: PrioritiesToolPort

  // The CoS chat is Claude-only and requires this key to run; web_search is
  // gated on it, so set it for the tool-set assertions.
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY
  afterAll(() => {
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey
  })

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    port = buildPort()
    context = {
      load: vi.fn(() =>
        Promise.resolve({
          conversationId: 'c1',
          electedOfficeId: 'office-1',
          organizationSlug: ORG,
          organization: { slug: ORG } as Organization,
          userFirstName: 'Jordan',
          userLastName: 'Lee',
          officeTitle: 'Council Member',
          jurisdiction: null,
          swornInDate: null,
          party: null,
          electedDate: null,
          termStartDate: null,
          termEndDate: null,
          priorities: [],
          isFirstConversation: false,
          anchor: null,
          districtFilters: null,
          constituentToolEnabled: false,
        }),
      ),
      civicPanelBuildState: vi.fn(() =>
        Promise.resolve({
          members: 0,
          inviteSent: false,
          hasPlan: false,
          goalMembers: 240,
        }),
      ),
    } as unknown as ChiefOfStaffContextService
  })

  const buildResolver = (): DistrictResolverService =>
    ({
      resolveByOrgSlug: vi.fn(() =>
        Promise.resolve({
          state: 'NC',
          l2DistrictType: 'city',
          l2DistrictName: 'Hendersonville',
        }),
      ),
      toMandatoryFilters: vi.fn(() => [
        { column: 'state_postal_code', value: 'NC' },
        { column: 'city', value: 'Hendersonville' },
      ]),
    }) as unknown as DistrictResolverService

  it('is a sensitive, Anthropic-only scope', () => {
    const handler = new ChiefOfStaffHandler(
      context,
      buildBriefings(),
      port,
      NO_TABLES,
    )
    expect(handler.scope).toBe(ChatScope.chief_of_staff)
    expect(handler.isSensitive).toBe(true)
    expect(handler.models).toEqual([...CHIEF_OF_STAFF_MODELS])
    expect(handler.models.every((m) => m.startsWith('claude'))).toBe(true)
  })

  it('builds the safe v1 tool set (priorities + briefing reads)', async () => {
    const handler = new ChiefOfStaffHandler(
      context,
      buildBriefings(),
      port,
      NO_TABLES,
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    const tools = handler.buildTools(ctx)
    // web_search is always present now (Anthropic native, gated at the LLM
    // layer on ANTHROPIC_API_KEY, not on an injected provider).
    expect(Object.keys(tools).sort()).toEqual([
      'ask_clarify_question',
      'compose_handoff',
      'crud_priorities',
      'get_briefing',
      'list_briefings',
      'present_outside_contact',
      'web_search',
    ])
  })

  it('includes web_search (Anthropic native, no provider needed)', async () => {
    const handler = new ChiefOfStaffHandler(
      context,
      buildBriefings(),
      port,
      NO_TABLES,
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    expect(Object.keys(handler.buildTools(ctx))).toContain('web_search')
  })

  it('builds a governance system prompt grounded in the context', async () => {
    const handler = new ChiefOfStaffHandler(
      context,
      buildBriefings(),
      port,
      NO_TABLES,
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    const prompt = handler.buildSystemPrompt(ctx)
    expect(prompt).toContain('Chief of Staff')
    expect(prompt).toContain('Council Member')
  })

  it('registers constituent-data tools when provider + filters + table are present', async () => {
    const handler = new ChiefOfStaffHandler(
      context,
      buildBriefings(),
      port,
      TEST_TABLES,
      new InMemoryDatabricksProvider(new Map()),
      buildResolver(),
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    expect(ctx.constituentToolEnabled).toBe(true)
    const tools = handler.buildTools(ctx)
    expect(Object.keys(tools)).toContain('query_constituent_data')
    expect(Object.keys(tools)).toContain('describe_constituent_data')
  })

  it('omits constituent-data tools without a scoped provider', async () => {
    const handler = new ChiefOfStaffHandler(
      context,
      buildBriefings(),
      port,
      TEST_TABLES,
      undefined,
      buildResolver(),
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    expect(Object.keys(handler.buildTools(ctx))).not.toContain(
      'query_constituent_data',
    )
  })

  it('omits constituent-data tools when no table is configured', async () => {
    const handler = new ChiefOfStaffHandler(
      context,
      buildBriefings(),
      port,
      NO_TABLES,
      new InMemoryDatabricksProvider(new Map()),
      buildResolver(),
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    expect(Object.keys(handler.buildTools(ctx))).not.toContain(
      'query_constituent_data',
    )
  })

  it('omits constituent-data tools when the district does not resolve', async () => {
    const resolver = {
      resolveByOrgSlug: vi.fn(() => Promise.resolve(null)),
      toMandatoryFilters: vi.fn(),
    } as unknown as DistrictResolverService
    const handler = new ChiefOfStaffHandler(
      context,
      buildBriefings(),
      port,
      TEST_TABLES,
      new InMemoryDatabricksProvider(new Map()),
      resolver,
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    expect(ctx.districtFilters).toBeNull()
    expect(Object.keys(handler.buildTools(ctx))).not.toContain(
      'query_constituent_data',
    )
  })

  describe('anchor + community issues tool', () => {
    const ANCHOR = {
      resourceType: 'community_issue' as const,
      resourceId: 'issue-abc',
      url: 'https://goodparty.org/issues/issue-abc',
      snapshot: {
        title: 'Fix the potholes on Main Street',
        summary: 'Residents have complained about road conditions.',
      },
    }

    it('prompt contains anchored_issue block with snapshot title and summary', async () => {
      const contextWithAnchor = {
        load: vi.fn(() =>
          Promise.resolve({
            conversationId: 'c1',
            electedOfficeId: 'office-1',
            organizationSlug: ORG,
            userFirstName: 'Jordan',
            userLastName: 'Lee',
            officeTitle: 'Council Member',
            jurisdiction: null,
            swornInDate: null,
            party: null,
            electedDate: null,
            termStartDate: null,
            termEndDate: null,
            priorities: [],
            isFirstConversation: false,
            anchor: ANCHOR,
            districtFilters: null,
            constituentToolEnabled: false,
          }),
        ),
      } as unknown as ChiefOfStaffContextService
      const handler = new ChiefOfStaffHandler(
        contextWithAnchor,
        buildBriefings(),
        port,
        NO_TABLES,
      )
      const ctx = await handler.loadContext('c1', USER_ID)
      const prompt = handler.buildSystemPrompt(ctx)
      expect(prompt).toContain('<anchored_issue>')
      expect(prompt).toContain('Fix the potholes on Main Street')
      expect(prompt).toContain(
        'Residents have complained about road conditions',
      )
    })

    it('prompt includes highlightedText when present in anchor snapshot', async () => {
      const anchorWithHighlight = {
        ...ANCHOR,
        snapshot: { ...ANCHOR.snapshot, highlightedText: 'key excerpt here' },
      }
      const contextWithAnchor = {
        load: vi.fn(() =>
          Promise.resolve({
            conversationId: 'c1',
            electedOfficeId: 'office-1',
            organizationSlug: ORG,
            userFirstName: null,
            userLastName: null,
            officeTitle: null,
            jurisdiction: null,
            swornInDate: null,
            party: null,
            electedDate: null,
            termStartDate: null,
            termEndDate: null,
            priorities: [],
            isFirstConversation: false,
            anchor: anchorWithHighlight,
            districtFilters: null,
            constituentToolEnabled: false,
          }),
        ),
      } as unknown as ChiefOfStaffContextService
      const handler = new ChiefOfStaffHandler(
        contextWithAnchor,
        buildBriefings(),
        port,
        NO_TABLES,
      )
      const ctx = await handler.loadContext('c1', USER_ID)
      const prompt = handler.buildSystemPrompt(ctx)
      expect(prompt).toContain('Highlighted: key excerpt here')
    })

    it('registers read_community_issues tool when port is provided', async () => {
      const communityPort: CommunityIssueReadPort = {
        list: vi.fn(),
        getDetail: vi.fn(),
      }
      const handler = new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        NO_TABLES,
        undefined,
        undefined,
        communityPort,
      )
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(Object.keys(handler.buildTools(ctx))).toContain(
        'read_community_issues',
      )
    })

    it('omits read_community_issues tool when port is absent', async () => {
      const handler = new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        NO_TABLES,
      )
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(Object.keys(handler.buildTools(ctx))).not.toContain(
        'read_community_issues',
      )
    })
  })

  describe('check reminder tool', () => {
    const priorityWith = (state: 'deferred' | 'out') => ({
      id: 'pri-1',
      title: 'Rents',
      description: 'Keep renters near transit.',
      archivedAt: null,
      flow: {
        currentStep: 'evidence' as const,
        nextAction: null,
        checks: [
          {
            stepId: 'define' as const,
            check: { state, who: '', question: '', raised: 0 },
          },
        ],
      },
    })
    const buildWithStatus = () =>
      new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        NO_TABLES,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          buildCheckReminderTool: vi.fn(() => ({
            record_check_reminder: {
              description: 'stub',
              inputSchema: undefined,
              execute: () => ({}),
            },
          })),
        } as unknown as PriorityStatusService,
      )

    it('registers only when a priority has a check put off', async () => {
      const handler = buildWithStatus()
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(Object.keys(handler.buildTools(ctx))).not.toContain(
        'record_check_reminder',
      )
      expect(
        Object.keys(
          handler.buildTools({ ...ctx, priorities: [priorityWith('out')] }),
        ),
      ).not.toContain('record_check_reminder')
      const withDeferral = { ...ctx, priorities: [priorityWith('deferred')] }
      expect(Object.keys(handler.buildTools(withDeferral))).toContain(
        'record_check_reminder',
      )
      expect(handler.buildSystemPrompt(withDeferral)).toContain(
        'CHECKS THEY PUT OFF',
      )
    })
  })

  // Guarded on the injected service alone, and the tool's own unit tests
  // cannot see the wiring — a mis-wired provider would leave them all green.
  describe('help center tool', () => {
    const buildHelpCenterHandler = (helpCenter?: HelpCenterSearchService) =>
      new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        NO_TABLES,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        helpCenter,
      )

    it('registers search_help_center when the service is wired', async () => {
      const handler = buildHelpCenterHandler({} as HelpCenterSearchService)
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(Object.keys(handler.buildTools(ctx))).toContain(
        'search_help_center',
      )
    })

    it('omits search_help_center when no service is wired', async () => {
      const handler = buildHelpCenterHandler(undefined)
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(Object.keys(handler.buildTools(ctx))).not.toContain(
        'search_help_center',
      )
    })
  })

  describe('CRM contact tools', () => {
    const buildContacts = (): ContactsService =>
      ({
        getFilterDimensions: vi.fn(() => []),
        countContacts: vi.fn(),
      }) as unknown as ContactsService

    const buildVoterFileFilters = (): VoterFileFilterService =>
      ({
        findByOrganizationSlug: vi.fn(() => Promise.resolve([])),
      }) as unknown as VoterFileFilterService

    const buildCrmHandler = (deps: {
      contacts?: ContactsService
      voterFileFilters?: VoterFileFilterService
    }) =>
      new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        NO_TABLES,
        undefined,
        undefined,
        undefined,
        deps.contacts,
        deps.voterFileFilters,
      )

    it('registers describe_filter_dimensions and count_contacts whenever contacts + organization resolve', async () => {
      const handler = buildCrmHandler({ contacts: buildContacts() })
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(ctx.organization).toEqual({ slug: ORG })
      const toolNames = Object.keys(handler.buildTools(ctx))
      expect(toolNames).toContain('describe_filter_dimensions')
      expect(toolNames).toContain('count_contacts')
    })

    it('tells the catalog which registered tools take its filter shape', async () => {
      const handler = buildCrmHandler({ contacts: buildContacts() })
      const ctx = await handler.loadContext('c1', USER_ID)
      const tools = handler.buildTools(ctx)
      expect(
        descriptionOf(tools.describe_filter_dimensions).split('\n\n')[0],
      ).toContain('for count_contacts')
    })

    // Precinct is the one filter dimension describe_filter_dimensions
    // cannot carry — its values are per-district — so this tool is the only
    // route to it. Without it registered the assistant tells an office
    // holder their own precinct is not a dimension it can filter on, while
    // the wizard beside it offers exactly that filter.
    it('registers list_precincts alongside the other aggregate reads', async () => {
      const handler = buildCrmHandler({ contacts: buildContacts() })
      const ctx = await handler.loadContext('c1', USER_ID)
      const toolNames = Object.keys(handler.buildTools(ctx))
      expect(toolNames).toContain('list_precincts')
    })

    it('registers CRM tools whose descriptions carry the shared routing rules', async () => {
      const handler = buildCrmHandler({ contacts: buildContacts() })
      const ctx = await handler.loadContext('c1', USER_ID)
      const tools = handler.buildTools(ctx)
      expect(descriptionOf(tools.describe_filter_dimensions)).toContain(
        DATA_SOURCE_ROUTING_RULES,
      )
      expect(descriptionOf(tools.count_contacts)).toContain(
        DATA_SOURCE_ROUTING_RULES,
      )
    })

    it('omits both tools without the contacts service', async () => {
      const handler = buildCrmHandler({})
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(Object.keys(handler.buildTools(ctx))).not.toContain(
        'count_contacts',
      )
    })

    it('advertises the tools and rules in the prompt only when registered', async () => {
      const onHandler = buildCrmHandler({ contacts: buildContacts() })
      const onPrompt = onHandler.buildSystemPrompt(
        await onHandler.loadContext('c1', USER_ID),
      )
      expect(onPrompt).toContain('count_contacts')
      expect(onPrompt).toContain('describe_filter_dimensions')
      expect(onPrompt).toContain('CONTACT LIST RULES')

      const offHandler = buildCrmHandler({})
      const offPrompt = offHandler.buildSystemPrompt(
        await offHandler.loadContext('c1', USER_ID),
      )
      expect(offPrompt).not.toContain('count_contacts')
      expect(offPrompt).not.toContain('CONTACT LIST RULES')
    })

    it('registers crud_saved_filters when the voter-file-filter service is present', async () => {
      const handler = buildCrmHandler({
        contacts: buildContacts(),
        voterFileFilters: buildVoterFileFilters(),
      })
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(Object.keys(handler.buildTools(ctx))).toContain(
        'crud_saved_filters',
      )
      const prompt = handler.buildSystemPrompt(ctx)
      expect(prompt).toContain('crud_saved_filters')
      expect(prompt).toContain('SAVED LIST RULES')
    })

    it('keeps the read tools but omits crud without the filter service', async () => {
      const handler = buildCrmHandler({ contacts: buildContacts() })
      const ctx = await handler.loadContext('c1', USER_ID)
      const toolNames = Object.keys(handler.buildTools(ctx))
      expect(toolNames).toContain('count_contacts')
      expect(toolNames).not.toContain('crud_saved_filters')
      expect(handler.buildSystemPrompt(ctx)).not.toContain('crud_saved_filters')
    })

    // The constituents card is built and kept, but not offered: no tool hands
    // the model a contact id, so it could only be called with invented ones.
    it('holds constituents back and offers proposals only with saved lists', async () => {
      const readOnly = buildCrmHandler({ contacts: buildContacts() })
      const readOnlyTools = Object.keys(
        readOnly.buildTools(await readOnly.loadContext('c1', USER_ID)),
      )
      expect(readOnlyTools).not.toContain('present_constituents')
      expect(readOnlyTools).not.toContain('present_outreach_proposal')

      const withLists = buildCrmHandler({
        contacts: buildContacts(),
        voterFileFilters: buildVoterFileFilters(),
      })
      const withListsTools = Object.keys(
        withLists.buildTools(await withLists.loadContext('c1', USER_ID)),
      )
      expect(withListsTools).toContain('present_outreach_proposal')
    })

    it('sizes a text sample only where a proposal can be presented', async () => {
      const readOnly = buildCrmHandler({ contacts: buildContacts() })
      const readOnlyCtx = await readOnly.loadContext('c1', USER_ID)
      expect(Object.keys(readOnly.buildTools(readOnlyCtx))).not.toContain(
        'size_outreach_sample',
      )
      expect(readOnly.buildSystemPrompt(readOnlyCtx)).not.toContain(
        'SAMPLING RULES',
      )

      const withLists = buildCrmHandler({
        contacts: buildContacts(),
        voterFileFilters: buildVoterFileFilters(),
      })
      const ctx = await withLists.loadContext('c1', USER_ID)
      expect(Object.keys(withLists.buildTools(ctx))).toContain(
        'size_outreach_sample',
      )
      const prompt = withLists.buildSystemPrompt(ctx)
      expect(prompt).toContain('SAMPLING RULES')
      expect(prompt).toContain('propose the sample by default')
      expect(prompt).toContain(
        'Texting all 58,520 is about $2,048. Texting 2,767 of them is ' +
          'about $97 and should bring back about 83 replies.',
      )
      expect(prompt).toContain('never work out a sample or a cost yourself')
      expect(prompt).toContain("I'd text 2,767 of the 58,520")
      expect(prompt).toContain('For a text to everyone, leave all three out')
      expect(prompt).toContain('Never call it statistically proven')
    })

    it('has no earlier sample to widen outside a priority', () => {
      expect(
        Object.keys(buildPresentOutreachProposalTool().inputSchema.shape),
      ).not.toContain('widensOutreachIds')
    })

    it('keeps the proposal out of the filter catalog', async () => {
      const handler = buildCrmHandler({
        contacts: buildContacts(),
        voterFileFilters: buildVoterFileFilters(),
      })
      const tools = handler.buildTools(await handler.loadContext('c1', USER_ID))
      expect(descriptionOf(tools.describe_filter_dimensions)).not.toContain(
        'present_outreach_proposal',
      )
    })
  })

  describe('building the civic panel', () => {
    const buildPanelHandler = (flags: { panels: boolean }) => {
      const features = {
        isFeatureEnabled: vi.fn(({ feature }: { feature: string }) =>
          Promise.resolve(
            feature === 'serve-citizen-panels' ? flags.panels : false,
          ),
        ),
      }
      const handler = new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        NO_TABLES,
        undefined,
        undefined,
        undefined,
        {
          getFilterDimensions: vi.fn(() => []),
          countContacts: vi.fn(),
        } as unknown as ContactsService,
        {
          findByOrganizationSlug: vi.fn(() => Promise.resolve([])),
        } as unknown as VoterFileFilterService,
        undefined,
        undefined,
        undefined,
        undefined,
        features as never,
        undefined,
        undefined,
        {} as CivicPanelBuildPlanService,
      )
      return { handler, features }
    }

    const withPanel = (state: {
      members: number
      inviteSent: boolean
      hasPlan?: boolean
    }) => {
      context.civicPanelBuildState = vi.fn(() =>
        Promise.resolve({ hasPlan: false, goalMembers: 240, ...state }),
      )
    }

    const promptFor = async (
      override: { priorities?: PriorityRecord[] } = {},
    ) => {
      const { handler } = buildPanelHandler({ panels: true })
      const ctx = await handler.loadContext('c1', USER_ID)
      return handler.buildSystemPrompt({ ...ctx, ...override })
    }

    const PLAN_TOOLS = [
      'ask_panel_weekly_time',
      'save_panel_weekly_time',
      'present_panel_next_step',
    ]

    it('registers the plan tools, and no single invite text', async () => {
      const { handler } = buildPanelHandler({ panels: true })
      const tools = handler.buildTools(await handler.loadContext('c1', USER_ID))
      expect(Object.keys(tools)).toEqual(expect.arrayContaining(PLAN_TOOLS))
      expect(Object.keys(tools)).not.toContain('size_panel_invite')
      expect(
        Object.keys(
          (
            tools.present_outreach_proposal as unknown as {
              inputSchema: { shape: object }
            }
          ).inputSchema.shape,
        ),
      ).toEqual(
        Object.keys(buildPresentOutreachProposalTool().inputSchema.shape),
      )
    })

    it('explains, then asks the weekly time question and makes the plan from the answer', async () => {
      const prompt = await promptFor()
      expect(prompt).toContain(
        "CIVIC PANEL (apply when the user's message is exactly " +
          `"${BUILD_CITIZENS_PANEL_MESSAGE}"`,
      )
      expect(prompt).toContain('- Explain what a civic panel is')
      expect(prompt).toContain(
        '"A civic panel is residents from every part of your district who ' +
          'agreed to tell you what they think before you decide."',
      )
      expect(prompt).toContain(
        'Never say how members are found, picked or invited',
      )
      expect(prompt).not.toContain('picking people at random')
      expect(prompt).toContain(
        'call `ask_panel_weekly_time` with nothing after it',
      )
      expect(prompt).toContain(
        'never write the question or the answers yourself',
      )
      expect(prompt).toContain(
        'call `save_panel_weekly_time` with the hours: 4 for "4 or more ' +
          'hours a week"',
      )
      expect(prompt).toContain(
        'When it returns saved "created", call `present_panel_next_step`',
      )
      expect(prompt).toContain(
        'Never propose a text, a list or any other outreach to build the ' +
          'panel',
      )
      expect(prompt).not.toContain('size_panel_invite')
      expect(prompt).not.toContain('civicPanelAsk true')
    })

    it('says what to do when no plan can be made, pointing at the panel page', async () => {
      const prompt = await promptFor()
      expect(prompt).toContain(
        'When it returns planMade false, no plan could be made.',
      )
      expect(prompt).toContain(
        'link their panel page as [See your civic panel](/dashboard/contacts/citizens-panel)',
      )
    })

    it('shows the plan an office already has and never asks again', async () => {
      withPanel({ members: 3, inviteSent: true, hasPlan: true })
      const prompt = await promptFor()
      expect(prompt).toContain(
        'They already have a plan to build it. Never ask the weekly time ' +
          'question again. Call `present_panel_next_step`',
      )
      expect(prompt).not.toContain(
        'call `ask_panel_weekly_time` with nothing after it',
      )
      expect(prompt).toContain('"I can give 2 hours now"')
      expect(prompt).toContain('When it returns saved "updated"')
    })

    it('grows a panel with members but no plan through the same question', async () => {
      withPanel({ members: 42, inviteSent: true })
      const prompt = await promptFor()
      expect(prompt).toContain(
        'They already have 42 people on their civic panel',
      )
      expect(prompt).toContain(
        'call `ask_panel_weekly_time` with nothing after it',
      )
      expect(prompt).not.toContain('- Explain what a civic panel is')
    })

    it('ends on priorities once the first invite is out and none are on file', async () => {
      withPanel({ members: 0, inviteSent: true, hasPlan: true })
      const prompt = await promptFor()
      expect(prompt).toContain(
        'Their first invite is out and they have no priorities on file.',
      )
      expect(prompt).toContain('offer to record what they tell you')
    })

    it('does not ask for priorities before the first invite is out', async () => {
      withPanel({ members: 0, inviteSent: false })
      const prompt = await promptFor()
      expect(prompt).not.toContain('they have no priorities on file.')
      expect(prompt).toContain('Do not ask about priorities in this reply')
    })

    it('ends on the plan, not on priorities, when some are on file', async () => {
      withPanel({ members: 0, inviteSent: true, hasPlan: true })
      const prompt = await promptFor({
        priorities: [
          {
            id: 'pri-1',
            title: 'Rents',
            description: 'Keep renters near transit.',
            archivedAt: null,
            flow: { currentStep: 'evidence', nextAction: null, checks: [] },
          },
        ],
      })
      expect(prompt).not.toContain('they have no priorities on file.')
      expect(prompt).toContain(
        'They already have priorities on file. Never ask them to record priorities',
      )
    })

    it('offers to keep a panel at its goal fresh, through the same question', async () => {
      withPanel({ members: 240, inviteSent: true })
      const prompt = await promptFor()
      expect(prompt).toContain(
        'Their civic panel already has 240 people, its goal.',
      )
      expect(prompt).toContain('keep it fresh')
      expect(prompt).toContain(
        'call `ask_panel_weekly_time` with nothing after it',
      )
    })

    it('says the invite is out, then plans the calls and doors', async () => {
      withPanel({ members: 0, inviteSent: true })
      const prompt = await promptFor()
      expect(prompt).toContain('Their panel invite already went out')
      expect(prompt).toContain(
        'call `ask_panel_weekly_time` with nothing after it',
      )
    })

    it('links the panel page when the plan tools are not there', async () => {
      const handler = new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        NO_TABLES,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          isFeatureEnabled: vi.fn(() => Promise.resolve(true)),
        } as never,
      )
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(Object.keys(handler.buildTools(ctx))).not.toContain(
        'ask_panel_weekly_time',
      )
      expect(handler.buildSystemPrompt(ctx)).toContain(
        'link it as [Build your civic panel](/dashboard/contacts/citizens-panel)',
      )
    })

    // Two lines a build reply produced: "not just the people who already
    // reach out" (banned word) and "the panel ends up looking like
    // Asheville" (a promise the panel brief forbids). The panel page's own
    // status and group to invite next may be said, nothing past them.
    it('bans "just" and any promise that the panel will match the community', async () => {
      const prompt = await promptFor()
      const civicPanel = prompt.slice(prompt.indexOf('CIVIC PANEL ('))
      expect(civicPanel).toContain('Never use the word "just".')
      expect(civicPanel).toContain(
        'You may say the status their panel page shows (the panelStatus a ' +
          'panel tool returns: Too few members yet, Missing some groups or ' +
          'Every group on your panel) and the group it says to invite next ' +
          '(inviteMoreNext), in those words.',
      )
      expect(civicPanel).toContain(
        'Never promise or imply the panel will look like, match, mirror or ' +
          'represent the district, the city or the community.',
      )
      expect(civicPanel).toContain(
        'Never mention weights, quotas or targets, and never say or ' +
          "guess any one person's race.",
      )
      expect(civicPanel).not.toContain(
        'never suggest inviting or leaving out anyone by race',
      )
      expect(civicPanel).not.toContain('looks like the district')
      const explained = prompt.slice(prompt.indexOf('CIVIC PANEL EXPLAINED'))
      expect(explained).toContain('Never use the word "just".')
    })

    describe("What's a civic panel?", () => {
      it('explains the panel and asks before building anything', async () => {
        const prompt = await promptFor()
        expect(prompt).toContain(
          "CIVIC PANEL EXPLAINED (apply when the user's message is exactly " +
            `"${EXPLAIN_CIVIC_PANEL_MESSAGE}"`,
        )
        expect(prompt).toContain('They asked what it is, not to build one.')
        expect(prompt).toContain('do they want to build theirs?')
        expect(prompt).toContain(
          'The app shows a Build my panel button under your reply that ' +
            'starts it here',
        )
        expect(prompt).toContain(
          'Skip this when you already explained the panel earlier in this ' +
            'conversation',
        )
        expect(prompt).toContain(
          'never count the district, size an invite, draft a text or ' +
            'present a card',
        )
        expect(prompt).toContain(
          'Never call it representative, a poll, a survey panel, a focus ' +
            'group or proprietary.',
        )
      })

      it('offers no build to an office that already has members', async () => {
        withPanel({ members: 42, inviteSent: true })
        const prompt = await promptFor()
        expect(prompt).toContain(
          'they already have 42 people on their civic panel',
        )
        expect(prompt).not.toContain('do they want to build theirs?')
      })

      it('offers no build once the invite is out', async () => {
        withPanel({ members: 0, inviteSent: true })
        const prompt = await promptFor()
        expect(prompt).toContain('their panel invite already went out')
        expect(prompt).not.toContain('do they want to build theirs?')
      })
    })

    it('is unchanged with serve-citizen-panels off', async () => {
      const { handler } = buildPanelHandler({ panels: false })
      const ctx = await handler.loadContext('c1', USER_ID)
      const tools = handler.buildTools(ctx)
      expect(ctx.civicPanel).toBeUndefined()
      expect(context.civicPanelBuildState).not.toHaveBeenCalled()
      for (const name of PLAN_TOOLS) {
        expect(Object.keys(tools)).not.toContain(name)
      }
      expect(handler.buildSystemPrompt(ctx)).not.toContain('CIVIC PANEL')
    })

    it('sizes the panel goal from the district once a turn', async () => {
      const turn = async (answers: number) => {
        const districtAnswersNeeded = vi.fn(() => Promise.resolve(answers))
        const readStatuses = vi.fn(() => Promise.resolve(new Map()))
        context.civicPanelBuildState = vi.fn(() =>
          Promise.resolve({
            members: 0,
            inviteSent: false,
            hasPlan: false,
            goalMembers: 240,
          }),
        )
        const handler = new ChiefOfStaffHandler(
          context,
          buildBriefings(),
          port,
          NO_TABLES,
          undefined,
          undefined,
          undefined,
          {
            getFilterDimensions: vi.fn(() => []),
            countContacts: vi.fn(),
          } as unknown as ContactsService,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { isFeatureEnabled: vi.fn(() => Promise.resolve(true)) } as never,
          undefined,
          {
            districtAnswersNeeded,
            readStatuses,
          } as unknown as PriorityResultsService,
        )
        await handler.loadContext('c1', USER_ID)
        return { districtAnswersNeeded, readStatuses }
      }

      const city = await turn(96)
      expect(city.districtAnswersNeeded).toHaveBeenCalledTimes(1)
      expect(city.readStatuses).toHaveBeenCalledWith(ORG, [])
      expect(context.civicPanelBuildState).toHaveBeenCalledWith(ORG, 240)

      await turn(15)
      expect(context.civicPanelBuildState).toHaveBeenCalledWith(ORG, 38)
    })
  })

  describe('shared cards and past outreach', () => {
    const buildPastOutreachHandler = (outreach?: PriorityFlowOutreachService) =>
      new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        NO_TABLES,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        outreach,
      )

    it('reads the office-wide history with no priority behind it', async () => {
      const forPriority = vi.fn()
      const forOffice = vi.fn(() => Promise.resolve([]))
      const handler = buildPastOutreachHandler({
        forPriority,
        forOffice,
      } as unknown as PriorityFlowOutreachService)
      const tools = handler.buildTools(await handler.loadContext('c1', USER_ID))
      expect(Object.keys(tools)).toContain('present_past_outreach')
      const read = tools.read_past_outreach
      if (read === undefined || !('execute' in read)) {
        throw new Error('expected an executable tool')
      }
      expect(await read.execute({})).toEqual({ priority: [], office: [] })
      expect(forPriority).not.toHaveBeenCalled()
      expect(forOffice).toHaveBeenCalledWith(ORG, null, undefined)
    })

    it('reads outreach feedback only with serve-citizen-panels on for the user', async () => {
      const outreach = {
        forOffice: vi.fn(() => Promise.resolve([])),
      } as unknown as PriorityFlowOutreachService
      const build = (enabled: boolean) => {
        const features = {
          isFeatureEnabled: vi.fn(() => Promise.resolve(enabled)),
        }
        const handler = new ChiefOfStaffHandler(
          context,
          buildBriefings(),
          port,
          NO_TABLES,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          outreach,
          undefined,
          undefined,
          features as never,
        )
        return { handler, features }
      }

      const on = build(true)
      const onCtx = await on.handler.loadContext('c1', USER_ID)
      expect(on.features.isFeatureEnabled).toHaveBeenCalledWith({
        user: USER_ID,
        feature: 'serve-citizen-panels',
      })
      expect(Object.keys(on.handler.buildTools(onCtx))).toContain(
        'read_outreach_feedback',
      )

      const off = build(false)
      const offCtx = await off.handler.loadContext('c1', USER_ID)
      expect(Object.keys(off.handler.buildTools(offCtx))).not.toContain(
        'read_outreach_feedback',
      )
      expect(off.handler.buildSystemPrompt(offCtx)).not.toContain(
        'read_outreach_feedback',
      )
    })

    it('omits the past-outreach tools without the service', async () => {
      const handler = buildPastOutreachHandler(undefined)
      const tools = handler.buildTools(await handler.loadContext('c1', USER_ID))
      expect(Object.keys(tools)).not.toContain('read_past_outreach')
      expect(Object.keys(tools)).not.toContain('present_past_outreach')
    })

    it('omits the outside contact when there is no web search', async () => {
      delete process.env.ANTHROPIC_API_KEY
      const handler = buildPastOutreachHandler(undefined)
      const tools = handler.buildTools(await handler.loadContext('c1', USER_ID))
      expect(Object.keys(tools)).not.toContain('present_outside_contact')
      expect(Object.keys(tools)).toContain('ask_clarify_question')
    })

    it('never names a people card it does not offer', async () => {
      const handler = new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        NO_TABLES,
        undefined,
        undefined,
        undefined,
        {
          getFilterDimensions: vi.fn(() => []),
          countContacts: vi.fn(),
        } as unknown as ContactsService,
      )
      const prompt = handler.buildSystemPrompt(
        await handler.loadContext('c1', USER_ID),
      )
      expect(prompt).toContain('CARDS AND QUESTIONS')
      expect(prompt).toContain('`present_outside_contact` is someone OUTSIDE')
      expect(prompt).not.toContain('present_constituents')
    })
  })

  describe('compose_handoff tool', () => {
    const buildCtx = () =>
      ({
        load: vi.fn(() =>
          Promise.resolve({
            conversationId: 'c1',
            electedOfficeId: 'office-1',
            organizationSlug: ORG,
            organization: { slug: ORG } as Organization,
            userFirstName: 'Jordan',
            userLastName: 'Lee',
            officeTitle: 'Council Member',
            jurisdiction: null,
            swornInDate: null,
            party: null,
            electedDate: null,
            termStartDate: null,
            termEndDate: null,
            priorities: [],
            isFirstConversation: false,
            anchor: null,
            districtFilters: null,
            constituentToolEnabled: false,
          }),
        ),
      }) as unknown as ChiefOfStaffContextService

    it('registers compose_handoff', async () => {
      const handler = new ChiefOfStaffHandler(
        buildCtx(),
        buildBriefings(),
        port,
        NO_TABLES,
      )
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(Object.keys(handler.buildTools(ctx))).toContain('compose_handoff')
    })

    it('inputSchema converts to a top-level object json schema (Anthropic rejects anyOf roots)', async () => {
      const tool = buildComposeHandoffTool('serve_social')
      const converted = await asSchema(tool.inputSchema).jsonSchema
      expect(converted.type).toBe('object')
      expect(converted.anyOf).toBeUndefined()
    })

    it('execute returns the validated payload verbatim on valid input', async () => {
      const tool = buildComposeHandoffTool('serve_social')
      const input = { channel: 'serve_social' as const, draftText: 'Hello!' }
      const result = await tool.execute(input)
      expect(result).toEqual(input)
    })

    it('execute throws on invalid input (schema parse error)', () => {
      const tool = buildComposeHandoffTool('serve_social')
      type Input = Parameters<typeof tool.execute>[0]
      expect(() =>
        tool.execute({ channel: 'unknown' } as unknown as Input),
      ).toThrow()
    })
  })

  describe('finalizeAssistantText (guardrail backstops)', () => {
    const LEGAL = guardrailLine('legal_advice', 'chief_of_staff')
    const SMALL = guardrailLine('small_count', 'chief_of_staff')
    const HANDOFF = guardrailLine('handoff_draft', 'chief_of_staff')
    const noTools = { toolEvents: [] }
    const returned = (name: string, result: unknown) => ({
      toolEvents: [
        {
          toolCallId: `call-${name}`,
          name,
          args: {},
          status: 'returned' as const,
          result,
        },
      ],
    })
    const handler = () =>
      new ChiefOfStaffHandler(context, buildBriefings(), port, NO_TABLES)
    // The CoS eval failure that shipped with no caution: a statute citation,
    // a colleague's criminal exposure, and a complaint-filing path.
    const legalAnswer =
      'Under RCW 42.30.120 the vote is void. A colleague who knew and ' +
      'voted anyway could face criminal liability, and a resident can ' +
      'file a complaint with the county prosecutor.'

    it('ends an uncautioned legal reading with the legal line', () => {
      expect(handler().finalizeAssistantText(legalAnswer, noTools)).toBe(
        `\n\n${LEGAL}`,
      )
    })

    it('leaves an ordinary office answer untouched', () => {
      expect(
        handler().finalizeAssistantText(
          'Turnout in your district was about 65% last cycle.',
          noTools,
        ),
      ).toBeNull()
    })

    it('reads a bare section number in a summary as no legal signal', () => {
      expect(
        handler().finalizeAssistantText(
          'Item 4 amends § 3.2 of the fee schedule; staff recommend approval.',
          noTools,
        ),
      ).toBeNull()
    })

    it("adds no second caution to the model's own", () => {
      expect(
        handler().finalizeAssistantText(
          'RCW 42.30 applies. This is not a substitute for professional ' +
            'advice; check with your city attorney.',
          noTools,
        ),
      ).toBeNull()
    })

    it('adds the small-count line when a data result reports suppressed rows', () => {
      expect(
        handler().finalizeAssistantText(
          'Residents under 30 lean toward the levy.',
          returned('query_constituent_data', { rows: [], rowsSuppressed: 2 }),
        ),
      ).toBe(`\n\n${SMALL}`)
    })

    it('adds the handoff line when compose_handoff returned', () => {
      expect(
        handler().finalizeAssistantText(
          'The drawer is open with your post.',
          returned('compose_handoff', { ok: true }),
        ),
      ).toBe(`\n\n${HANDOFF}`)
    })

    it('stacks legal, then small count, then handoff', () => {
      const turn = {
        toolEvents: [
          ...returned('query_constituent_data', { rows: [], rowsSuppressed: 1 })
            .toolEvents,
          ...returned('compose_handoff', { ok: true }).toolEvents,
        ],
      }
      expect(handler().finalizeAssistantText(legalAnswer, turn)).toBe(
        `\n\n${LEGAL}\n\n${SMALL}\n\n${HANDOFF}`,
      )
    })
  })
})

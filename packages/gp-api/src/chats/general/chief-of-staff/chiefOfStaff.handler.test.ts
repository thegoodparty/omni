import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { asSchema } from 'ai'
import { ChatScope } from '../../../generated/prisma'
import {
  CHIEF_OF_STAFF_MODELS,
  ChiefOfStaffHandler,
} from './chiefOfStaff.handler'
import { ChiefOfStaffContextService } from './services/chiefOfStaffContext.service'
import { ChiefOfStaffBriefingsService } from './services/chiefOfStaffBriefings.service'
import { PrioritiesToolPort } from './services/prioritiesPort'
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
import { offeredCardKinds } from '../chat-tools/presentCard.tool'
import type { PriorityFlowOutreachService } from '../priority-flow/services/priorityFlowOutreach.service'
import type { PriorityStatusService } from '@/priorities/services/priorityStatus.service'
import type { ManagedCivicPanelService } from '@/contacts/services/managedCivicPanel.service'
import {
  MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE,
  MANAGED_CIVIC_PANEL_EXHAUSTED_MESSAGE,
  MANAGED_CIVIC_PANEL_HOW_IT_WORKS,
  MANAGED_CIVIC_PANEL_SET_UP_MESSAGE,
  START_MANAGED_CIVIC_PANEL_MESSAGE,
  type ManagedCivicPanel,
} from '@goodparty_org/contracts'

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
      'present_card',
      'web_search',
    ])
    expect(offeredCardKinds(tools)).toEqual(['outside_contact'])
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
      const readOnlyTools = readOnly.buildTools(
        await readOnly.loadContext('c1', USER_ID),
      )
      expect(offeredCardKinds(readOnlyTools)).not.toContain('constituents')
      expect(Object.keys(readOnlyTools)).not.toContain(
        'present_outreach_proposal',
      )

      const withLists = buildCrmHandler({
        contacts: buildContacts(),
        voterFileFilters: buildVoterFileFilters(),
      })
      const withListsTools = withLists.buildTools(
        await withLists.loadContext('c1', USER_ID),
      )
      expect(Object.keys(withListsTools)).toContain('present_outreach_proposal')
      expect(offeredCardKinds(withListsTools)).toEqual(
        expect.arrayContaining(['list_proposal', 'list_map']),
      )
      expect(offeredCardKinds(withListsTools)).not.toContain('constituents')
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

  describe('the civic panel GoodParty builds (managed)', () => {
    const MANAGED_TOOLS = [
      'explain_managed_panel',
      'offer_managed_panel_invite',
      'present_managed_panel_invite',
      'read_managed_panel',
      'present_managed_panel',
    ]
    const enrollment = {
      id: 'mp-1',
      status: 'building',
      approvedAt: new Date('2026-10-22T18:00:00Z'),
      progress: {
        members: 0,
        goalMembers: 275,
        wavesSent: 0,
        nextWaveAt: null,
      },
    } as unknown as ManagedCivicPanel

    const buildManagedHandler = ({
      panel,
      panels = true,
    }: {
      panel: ManagedCivicPanel | null
      panels?: boolean
    }) => {
      const read = vi.fn(() => Promise.resolve({ panel }))
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
          isFeatureEnabled: vi.fn(() => Promise.resolve(panels)),
        } as never,
        undefined,
        undefined,
        { read } as unknown as ManagedCivicPanelService,
      )
      return { handler, read }
    }

    it('offers the managed panel before the office approves', async () => {
      const { handler } = buildManagedHandler({ panel: null })
      const ctx = await handler.loadContext('c1', USER_ID)
      const names = Object.keys(handler.buildTools(ctx))
      expect(names).toEqual(expect.arrayContaining(MANAGED_TOOLS))

      const prompt = handler.buildSystemPrompt(ctx)
      expect(prompt).toContain(
        `MANAGED CIVIC PANEL (apply when the user's message is exactly "${START_MANAGED_CIVIC_PANEL_MESSAGE}"`,
      )
      expect(prompt).toContain(
        'call `explain_managed_panel` with part what_it_is and write the text it returns as your reply, word for word',
      )
      expect(prompt).toContain(
        `When they pick "${MANAGED_CIVIC_PANEL_HOW_IT_WORKS}"`,
      )
      expect(prompt).toContain(
        'call `explain_managed_panel` with part how_it_works',
      )
      expect(prompt).toContain(
        'call `offer_managed_panel_invite` with afterHowItWorks true',
      )
      expect(prompt).toContain(
        'Then call `offer_managed_panel_invite` with nothing after it',
      )
      expect(prompt).not.toMatch(/\bwaves? (at a time|we|in)\b|between waves/i)
      expect(prompt).toContain('Then call `present_managed_panel_invite`')
      expect(prompt).toContain(`On "${MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE}"`)
    })

    it('says when the first invites go out once the office approves', async () => {
      const { handler } = buildManagedHandler({ panel: enrollment })
      const ctx = await handler.loadContext('c1', USER_ID)
      const prompt = handler.buildSystemPrompt(ctx)
      expect(prompt).toContain(
        `On "${MANAGED_CIVIC_PANEL_SET_UP_MESSAGE}", call \`read_managed_panel\``,
      )
      expect(prompt).toContain(
        '"Done. The first invites go out <firstSendDate>. I\'ll let you know when your civic panel is ready, around the week of <readyWeekOf>."',
      )
      expect(prompt).toContain('Never offer or show the invite again.')
      expect(prompt).toContain('ask which priority they want to work on')

      const tools = handler.buildTools(ctx)
      const offer = tools.offer_managed_panel_invite as unknown as {
        execute: () => unknown
      }
      expect(offer.execute()).toMatchObject({ error: expect.any(String) })
    })

    it('knows each state once the office approves, and offers no link when invites run out', async () => {
      const { handler } = buildManagedHandler({ panel: enrollment })
      const ctx = await handler.loadContext('c1', USER_ID)
      const prompt = handler.buildSystemPrompt(ctx)
      for (const status of ['building', 'paused', 'ready', 'exhausted']) {
        expect(prompt).toContain(`  - ${status}: `)
      }
      expect(prompt).toContain('press Resume on their civic panel page')
      expect(prompt).toContain(
        `On "${MANAGED_CIVIC_PANEL_EXHAUSTED_MESSAGE}", call \`read_managed_panel\``,
      )
      const exhausted = prompt
        .split('\n')
        .find((line) => line.startsWith('  - exhausted: '))
      expect(exhausted).toContain('every resident we can text has been invited')
      expect(exhausted).not.toMatch(/link|page/i)
      expect(prompt).not.toMatch(/join (link|page)/i)
      expect(Object.keys(handler.buildTools(ctx))).not.toContain(
        'present_managed_panel_join_link',
      )
    })

    it('reads nothing with serve-citizen-panels off', async () => {
      const { handler, read } = buildManagedHandler({
        panel: null,
        panels: false,
      })
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(read).not.toHaveBeenCalled()
      expect(ctx.managedPanel).toBeUndefined()
      const names = Object.keys(handler.buildTools(ctx))
      for (const name of MANAGED_TOOLS) expect(names).not.toContain(name)
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
      expect(offeredCardKinds(tools)).toContain('past_outreach')
      const read = tools.read_past_outreach
      if (read === undefined || !('execute' in read)) {
        throw new Error('expected an executable tool')
      }
      expect(await read.execute({})).toEqual({ priority: [], office: [] })
      expect(forPriority).not.toHaveBeenCalled()
      expect(forOffice).toHaveBeenCalledWith(
        ORG,
        null,
        expect.stringMatching(/^US\//),
        undefined,
      )
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

    it('reads the walk or list the official names by its id', async () => {
      const feedbackFor = vi.fn(() => Promise.resolve([]))
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
        { feedbackFor } as unknown as PriorityFlowOutreachService,
        undefined,
        undefined,
        { isFeatureEnabled: vi.fn(() => Promise.resolve(true)) } as never,
      )
      const tools = handler.buildTools(await handler.loadContext('c1', USER_ID))
      const read = tools.read_outreach_feedback
      if (read === undefined || !('execute' in read)) {
        throw new Error('expected an executable tool')
      }

      expect(await read.execute({ outreachId: 7 })).toEqual({
        priorityThemes: [],
        sends: [],
      })
      expect(feedbackFor).toHaveBeenCalledWith(
        ORG,
        { priorityId: null, outreachId: 7 },
        expect.stringMatching(/^US\//),
      )
      await read.execute({ channel: 'phoneBanking' })
      expect(feedbackFor).toHaveBeenLastCalledWith(
        ORG,
        { priorityId: null, outreachId: undefined, channel: 'phoneBanking' },
        expect.stringMatching(/^US\//),
      )
      expect(descriptionOf(read)).toContain('with read_past_outreach')
      expect(descriptionOf(tools.read_past_outreach)).toContain(
        'text replies only',
      )
    })

    it('omits the past-outreach tools without the service', async () => {
      const handler = buildPastOutreachHandler(undefined)
      const tools = handler.buildTools(await handler.loadContext('c1', USER_ID))
      expect(Object.keys(tools)).not.toContain('read_past_outreach')
      expect(offeredCardKinds(tools)).not.toContain('past_outreach')
    })

    it('omits the outside contact when there is no web search', async () => {
      delete process.env.ANTHROPIC_API_KEY
      const handler = buildPastOutreachHandler(undefined)
      const tools = handler.buildTools(await handler.loadContext('c1', USER_ID))
      expect(offeredCardKinds(tools)).not.toContain('outside_contact')
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
      expect(prompt).toContain('An `outside_contact` card is someone OUTSIDE')
      expect(prompt).toContain('- `outside_contact`: One person or office')
      expect(prompt).not.toContain('constituents` card')
      expect(prompt).not.toContain('- `constituents`:')
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

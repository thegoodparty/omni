import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

const TEST_TABLES = [
  { table: 'constituent_aggregates', dimensions: ['age_band', 'gender'] },
]

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
          attachmentsEnabled: false,
        }),
      ),
    } as unknown as ChiefOfStaffContextService
  })

  const buildResolver = (): DistrictResolverService =>
    ({
      resolveByUserId: vi.fn(() =>
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
    const handler = new ChiefOfStaffHandler(context, buildBriefings(), port, [])
    expect(handler.scope).toBe(ChatScope.chief_of_staff)
    expect(handler.isSensitive).toBe(true)
    expect(handler.models).toEqual([...CHIEF_OF_STAFF_MODELS])
    expect(handler.models.every((m) => m.startsWith('claude'))).toBe(true)
  })

  it('builds the safe v1 tool set (priorities + briefing reads)', async () => {
    const handler = new ChiefOfStaffHandler(context, buildBriefings(), port, [])
    const ctx = await handler.loadContext('c1', USER_ID)
    const tools = handler.buildTools(ctx)
    // web_search is always present now (Anthropic native, gated at the LLM
    // layer on ANTHROPIC_API_KEY, not on an injected provider).
    expect(Object.keys(tools).sort()).toEqual([
      'crud_priorities',
      'get_briefing',
      'list_briefings',
      'web_search',
    ])
  })

  it('includes web_search (Anthropic native, no provider needed)', async () => {
    const handler = new ChiefOfStaffHandler(context, buildBriefings(), port, [])
    const ctx = await handler.loadContext('c1', USER_ID)
    expect(Object.keys(handler.buildTools(ctx))).toContain('web_search')
  })

  it('builds a governance system prompt grounded in the context', async () => {
    const handler = new ChiefOfStaffHandler(context, buildBriefings(), port, [])
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
      [],
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
      resolveByUserId: vi.fn(() => Promise.resolve(null)),
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
            attachmentsEnabled: false,
          }),
        ),
      } as unknown as ChiefOfStaffContextService
      const handler = new ChiefOfStaffHandler(
        contextWithAnchor,
        buildBriefings(),
        port,
        [],
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
            attachmentsEnabled: false,
          }),
        ),
      } as unknown as ChiefOfStaffContextService
      const handler = new ChiefOfStaffHandler(
        contextWithAnchor,
        buildBriefings(),
        port,
        [],
      )
      const ctx = await handler.loadContext('c1', USER_ID)
      const prompt = handler.buildSystemPrompt(ctx)
      expect(prompt).toContain('Highlighted: key excerpt here')
    })

    it('registers read_community_issues tool when port is provided', async () => {
      const communityPort: CommunityIssueReadPort = {
        getDetail: vi.fn(),
      }
      const handler = new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        [],
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
        [],
      )
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(Object.keys(handler.buildTools(ctx))).not.toContain(
        'read_community_issues',
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
        [],
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
        [],
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
  })

  describe('serve-chat-attachments flag gate (compose_handoff tool)', () => {
    const buildCtxWith = (attachmentsEnabled: boolean) =>
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
            attachmentsEnabled,
          }),
        ),
      }) as unknown as ChiefOfStaffContextService

    it('registers compose_handoff when the flag is on', async () => {
      const handler = new ChiefOfStaffHandler(
        buildCtxWith(true),
        buildBriefings(),
        port,
        [],
      )
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(Object.keys(handler.buildTools(ctx))).toContain('compose_handoff')
    })

    it('omits compose_handoff when the flag is off', async () => {
      const handler = new ChiefOfStaffHandler(
        buildCtxWith(false),
        buildBriefings(),
        port,
        [],
      )
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(Object.keys(handler.buildTools(ctx))).not.toContain(
        'compose_handoff',
      )
    })

    it('execute returns the validated payload verbatim on valid input', async () => {
      const tool = buildComposeHandoffTool()
      const input = { channel: 'serve_social' as const, draftText: 'Hello!' }
      const result = await tool.execute(input)
      expect(result).toEqual(input)
    })

    it('execute throws on invalid input (schema parse error)', () => {
      const tool = buildComposeHandoffTool()
      type Input = Parameters<typeof tool.execute>[0]
      expect(() =>
        tool.execute({ channel: 'unknown' } as unknown as Input),
      ).toThrow()
    })
  })

  describe('finalizeAssistantText (professional-advice backstop)', () => {
    it('appends the disclaimer to an eval-style legal-advice answer', () => {
      const handler = new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        [],
      )
      // The CoS eval failure that shipped with no disclaimer: a statute
      // citation, a colleague's criminal exposure, and a complaint-filing
      // path. Nothing appended a disclaimer before this change; the backstop
      // does now.
      const answer =
        'Under RCW 42.30.120 the vote is void. A colleague who knew and ' +
        'voted anyway could face criminal liability, and a resident can ' +
        'file a complaint with the county prosecutor.'
      const appended = handler.finalizeAssistantText(answer)
      expect(appended?.startsWith('\n\n')).toBe(true)
      expect(appended).toContain('qualified professional')
    })

    it('leaves an ordinary office answer untouched', () => {
      const handler = new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        [],
      )
      expect(
        handler.finalizeAssistantText(
          'Turnout in your district was about 65% last cycle.',
        ),
      ).toBeNull()
    })

    it("does not double the model's own disclaimer", () => {
      const handler = new ChiefOfStaffHandler(
        context,
        buildBriefings(),
        port,
        [],
      )
      expect(
        handler.finalizeAssistantText(
          'RCW 42.30 applies. This is not a substitute for professional ' +
            'advice; check with your city attorney.',
        ),
      ).toBeNull()
    })
  })
})

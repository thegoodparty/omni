import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatScope } from '../../../generated/prisma'
import {
  CHIEF_OF_STAFF_MODELS,
  ChiefOfStaffHandler,
} from './chiefOfStaff.handler'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import { ChiefOfStaffContextService } from './services/chiefOfStaffContext.service'
import { ChiefOfStaffBriefingsService } from './services/chiefOfStaffBriefings.service'
import { PrioritiesToolPort } from './services/prioritiesPort'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { InMemoryDatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { FeaturesService } from '@/features/services/features.service'
import type { CommunityIssueReadPort } from './services/communityIssueRead.port'
import type { Organization } from '../../../generated/prisma'
import type { ContactsService } from '@/contacts/services/contacts.service'
import type { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'

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

const buildFeatures = (enabled: boolean): FeaturesService =>
  ({
    isFeatureEnabled: vi.fn(() => Promise.resolve(enabled)),
  }) as unknown as FeaturesService

const buildThrowingFeatures = (): FeaturesService =>
  ({
    isFeatureEnabled: vi.fn(() => Promise.reject(new Error('amplitude down'))),
  }) as unknown as FeaturesService

describe('ChiefOfStaffHandler', () => {
  let store: GeneralChatStoreService
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
    store = {
      createScopedConversation: vi.fn(),
    } as unknown as GeneralChatStoreService
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
          priorities: [],
          anchor: null,
          districtFilters: null,
          constituentToolEnabled: false,
          crmToolsEnabled: false,
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
    const handler = new ChiefOfStaffHandler(
      store,
      context,
      buildBriefings(),
      port,
      [],
    )
    expect(handler.scope).toBe(ChatScope.chief_of_staff)
    expect(handler.isSensitive).toBe(true)
    expect(handler.models).toEqual([...CHIEF_OF_STAFF_MODELS])
    expect(handler.models.every((m) => m.startsWith('claude'))).toBe(true)
  })

  it('always creates a new conversation (never resumes the latest)', async () => {
    // Each "new chat" must be its own conversation: resolveConversation always
    // creates a fresh one rather than resuming the most recent.
    store.createScopedConversation = vi.fn(() =>
      Promise.resolve({ id: 'fresh' }),
    ) as never
    const handler = new ChiefOfStaffHandler(
      store,
      context,
      buildBriefings(),
      port,
      [],
    )
    const result = await handler.resolveConversation(
      { scope: ChatScope.chief_of_staff, organizationSlug: ORG },
      USER_ID,
    )
    expect(result).toEqual({ conversationId: 'fresh', created: true })
    expect(store.createScopedConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: USER_ID,
        organizationSlug: ORG,
        scope: ChatScope.chief_of_staff,
      }),
    )
  })

  it('builds the safe v1 tool set (priorities + briefing reads)', async () => {
    const handler = new ChiefOfStaffHandler(
      store,
      context,
      buildBriefings(),
      port,
      [],
    )
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
    const handler = new ChiefOfStaffHandler(
      store,
      context,
      buildBriefings(),
      port,
      [],
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    expect(Object.keys(handler.buildTools(ctx))).toContain('web_search')
  })

  it('builds a governance system prompt grounded in the context', async () => {
    const handler = new ChiefOfStaffHandler(
      store,
      context,
      buildBriefings(),
      port,
      [],
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    const prompt = handler.buildSystemPrompt(ctx)
    expect(prompt).toContain('Chief of Staff')
    expect(prompt).toContain('Council Member')
  })

  it('registers constituent-data tools when provider + filters + table + flag', async () => {
    const handler = new ChiefOfStaffHandler(
      store,
      context,
      buildBriefings(),
      port,
      TEST_TABLES,
      new InMemoryDatabricksProvider(new Map()),
      buildResolver(),
      buildFeatures(true),
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    const tools = handler.buildTools(ctx)
    expect(Object.keys(tools)).toContain('query_constituent_data')
    expect(Object.keys(tools)).toContain('describe_constituent_data')
  })

  it('omits constituent-data tools when the feature flag is off', async () => {
    const handler = new ChiefOfStaffHandler(
      store,
      context,
      buildBriefings(),
      port,
      TEST_TABLES,
      new InMemoryDatabricksProvider(new Map()),
      buildResolver(),
      buildFeatures(false),
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    expect(ctx.constituentToolEnabled).toBe(false)
    expect(Object.keys(handler.buildTools(ctx))).not.toContain(
      'query_constituent_data',
    )
  })

  it('keeps the chat working (tool off) when the flag service throws', async () => {
    const handler = new ChiefOfStaffHandler(
      store,
      context,
      buildBriefings(),
      port,
      TEST_TABLES,
      new InMemoryDatabricksProvider(new Map()),
      buildResolver(),
      buildThrowingFeatures(),
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    expect(ctx.constituentToolEnabled).toBe(false)
    expect(Object.keys(handler.buildTools(ctx))).not.toContain(
      'query_constituent_data',
    )
  })

  it('omits constituent-data tools without a scoped provider', async () => {
    const handler = new ChiefOfStaffHandler(
      store,
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
      store,
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
      store,
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

    it('passes anchor and title to createScopedConversation', async () => {
      store.createScopedConversation = vi.fn(() =>
        Promise.resolve({ id: 'anchored' }),
      ) as never
      const handler = new ChiefOfStaffHandler(
        store,
        context,
        buildBriefings(),
        port,
        [],
      )
      const result = await handler.resolveConversation(
        {
          scope: ChatScope.chief_of_staff,
          organizationSlug: ORG,
          anchor: ANCHOR,
        },
        USER_ID,
      )
      expect(result).toEqual({ conversationId: 'anchored', created: true })
      expect(store.createScopedConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          anchor: ANCHOR,
          title: 'Fix the potholes on Main Street',
        }),
      )
    })

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
            priorities: [],
            anchor: ANCHOR,
            districtFilters: null,
            constituentToolEnabled: false,
          }),
        ),
      } as unknown as ChiefOfStaffContextService
      const handler = new ChiefOfStaffHandler(
        store,
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
            priorities: [],
            anchor: anchorWithHighlight,
            districtFilters: null,
            constituentToolEnabled: false,
          }),
        ),
      } as unknown as ChiefOfStaffContextService
      const handler = new ChiefOfStaffHandler(
        store,
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
        store,
        context,
        buildBriefings(),
        port,
        [],
        undefined,
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
        store,
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

  describe('CRM contact tools (serve-crm gating)', () => {
    const buildContacts = (): ContactsService =>
      ({
        getFilterDimensions: vi.fn(() => []),
        countContacts: vi.fn(),
      }) as unknown as ContactsService

    const buildCrmHandler = (deps: {
      features?: FeaturesService
      contacts?: ContactsService
      voterFileFilters?: VoterFileFilterService
    }) =>
      new ChiefOfStaffHandler(
        store,
        context,
        buildBriefings(),
        port,
        [],
        undefined,
        undefined,
        deps.features,
        undefined,
        deps.contacts,
        deps.voterFileFilters,
      )

    it('registers both tools when contacts service present and serve-crm on', async () => {
      const features = buildFeatures(true)
      const handler = buildCrmHandler({ features, contacts: buildContacts() })
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(ctx.crmToolsEnabled).toBe(true)
      expect(features.isFeatureEnabled).toHaveBeenCalledWith({
        user: USER_ID,
        feature: 'serve-crm',
      })
      const toolNames = Object.keys(handler.buildTools(ctx))
      expect(toolNames).toContain('describe_filter_dimensions')
      expect(toolNames).toContain('count_contacts')
    })

    it('omits both tools when the serve-crm flag is off', async () => {
      const handler = buildCrmHandler({
        features: buildFeatures(false),
        contacts: buildContacts(),
      })
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(ctx.crmToolsEnabled).toBe(false)
      const toolNames = Object.keys(handler.buildTools(ctx))
      expect(toolNames).not.toContain('describe_filter_dimensions')
      expect(toolNames).not.toContain('count_contacts')
    })

    it('omits both tools (and never hits Amplitude) without the contacts service', async () => {
      const features = buildFeatures(true)
      const handler = buildCrmHandler({ features })
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(ctx.crmToolsEnabled).toBe(false)
      expect(features.isFeatureEnabled).not.toHaveBeenCalled()
      expect(Object.keys(handler.buildTools(ctx))).not.toContain(
        'count_contacts',
      )
    })

    it('keeps the chat working (tools off) when the flag service throws', async () => {
      const handler = buildCrmHandler({
        features: buildThrowingFeatures(),
        contacts: buildContacts(),
      })
      const ctx = await handler.loadContext('c1', USER_ID)
      expect(ctx.crmToolsEnabled).toBe(false)
      expect(Object.keys(handler.buildTools(ctx))).not.toContain(
        'count_contacts',
      )
    })

    it('advertises the tools and rules in the prompt only when registered', async () => {
      const onHandler = buildCrmHandler({
        features: buildFeatures(true),
        contacts: buildContacts(),
      })
      const onPrompt = onHandler.buildSystemPrompt(
        await onHandler.loadContext('c1', USER_ID),
      )
      expect(onPrompt).toContain('count_contacts')
      expect(onPrompt).toContain('describe_filter_dimensions')
      expect(onPrompt).toContain('CONTACT LIST RULES')

      const offHandler = buildCrmHandler({
        features: buildFeatures(false),
        contacts: buildContacts(),
      })
      const offPrompt = offHandler.buildSystemPrompt(
        await offHandler.loadContext('c1', USER_ID),
      )
      expect(offPrompt).not.toContain('count_contacts')
      expect(offPrompt).not.toContain('CONTACT LIST RULES')
    })

    const buildVoterFileFilters = (): VoterFileFilterService =>
      ({
        findByOrganizationSlug: vi.fn(() => Promise.resolve([])),
      }) as unknown as VoterFileFilterService

    it('registers crud_saved_filters under the same serve-crm gate', async () => {
      const handler = buildCrmHandler({
        features: buildFeatures(true),
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

      const offHandler = buildCrmHandler({
        features: buildFeatures(false),
        contacts: buildContacts(),
        voterFileFilters: buildVoterFileFilters(),
      })
      const offCtx = await offHandler.loadContext('c1', USER_ID)
      expect(Object.keys(offHandler.buildTools(offCtx))).not.toContain(
        'crud_saved_filters',
      )
      expect(offHandler.buildSystemPrompt(offCtx)).not.toContain(
        'crud_saved_filters',
      )
    })

    it('keeps the read tools but omits crud without the filter service', async () => {
      const handler = buildCrmHandler({
        features: buildFeatures(true),
        contacts: buildContacts(),
      })
      const ctx = await handler.loadContext('c1', USER_ID)
      const toolNames = Object.keys(handler.buildTools(ctx))
      expect(toolNames).toContain('count_contacts')
      expect(toolNames).not.toContain('crud_saved_filters')
      expect(handler.buildSystemPrompt(ctx)).not.toContain('crud_saved_filters')
    })
  })

  describe('finalizeAssistantText (professional-advice backstop)', () => {
    it('appends the disclaimer to an eval-style legal-advice answer', () => {
      const handler = new ChiefOfStaffHandler(
        store,
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
        store,
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
        store,
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

import { beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('ChiefOfStaffHandler', () => {
  let store: GeneralChatStoreService
  let context: ChiefOfStaffContextService
  let port: PrioritiesToolPort

  beforeEach(() => {
    port = buildPort()
    store = {
      findScopedConversation: vi.fn(),
      createScopedConversation: vi.fn(),
    } as unknown as GeneralChatStoreService
    context = {
      load: vi.fn(() =>
        Promise.resolve({
          conversationId: 'c1',
          electedOfficeId: 'office-1',
          userFirstName: 'Jordan',
          userLastName: 'Lee',
          officeTitle: 'Council Member',
          jurisdiction: null,
          swornInDate: null,
          priorities: [],
          districtFilters: null,
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

  it('returns an existing conversation (find)', async () => {
    store.findScopedConversation = vi.fn(() =>
      Promise.resolve({ id: 'existing' }),
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
    expect(result).toEqual({ conversationId: 'existing', created: false })
    expect(store.createScopedConversation).not.toHaveBeenCalled()
  })

  it('creates a conversation when none exists (create)', async () => {
    store.findScopedConversation = vi.fn(() => Promise.resolve(null)) as never
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
    expect(store.createScopedConversation).toHaveBeenCalledWith({
      ownerUserId: USER_ID,
      organizationSlug: ORG,
      scope: ChatScope.chief_of_staff,
    })
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
    // No search provider injected -> web_search omitted.
    expect(Object.keys(tools).sort()).toEqual([
      'crud_priorities',
      'get_briefing',
      'list_briefings',
    ])
  })

  it('includes web_search when a search provider is present', async () => {
    const handler = new ChiefOfStaffHandler(
      store,
      context,
      buildBriefings(),
      port,
      [],
      { search: vi.fn(() => Promise.resolve([])) },
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
      undefined,
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
      undefined,
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

  it('omits constituent-data tools without a scoped provider', async () => {
    const handler = new ChiefOfStaffHandler(
      store,
      context,
      buildBriefings(),
      port,
      TEST_TABLES,
      undefined,
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
      undefined,
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
      undefined,
      new InMemoryDatabricksProvider(new Map()),
      resolver,
    )
    const ctx = await handler.loadContext('c1', USER_ID)
    expect(ctx.districtFilters).toBeNull()
    expect(Object.keys(handler.buildTools(ctx))).not.toContain(
      'query_constituent_data',
    )
  })
})

import { describe, expect, it, vi } from 'vitest'
import { ChatScope } from '../../../generated/prisma'
import type { CampaignsService } from '@/campaigns/services/campaigns.service'
import type { ChatStoreService } from '@/chats/services/chatStore.prisma'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { WIN_CONSTITUENT_TABLES } from './services/constituentDataScope'
import type { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import {
  buildStoryGreeting,
  CampaignManagerHandler,
} from './campaignManager.handler'
import type { CampaignManagerContext } from './campaignManagerPrompt'
import type {
  CampaignStoryIntakeService,
  StoryState,
} from './campaignStoryIntake.service'
import type { ContactsService } from '@/contacts/services/contacts.service'
import type { FeaturesService } from '@/features/services/features.service'
import type { Organization } from '../../../generated/prisma'

const fakeProvider = { query: vi.fn() } as unknown as DatabricksProvider

const buildHandler = (provider?: DatabricksProvider): CampaignManagerHandler =>
  new CampaignManagerHandler(
    {} as GeneralChatStoreService,
    {} as CampaignsService,
    {} as ChatStoreService,
    WIN_CONSTITUENT_TABLES,
    provider,
  )

const ctxWith = (
  over: Partial<CampaignManagerContext>,
): CampaignManagerContext => ({
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
  story: null,
  plan: null,
  ...over,
})

const ENABLED = {
  districtFilters: [
    { column: 'state_postal_code', value: 'IL' },
    { column: 'City', value: 'Springfield' },
  ],
  constituentToolEnabled: true,
}

describe('CampaignManagerHandler.buildTools — constituent data gating', () => {
  it('registers the constituent tools when provider, district, and flag are set', () => {
    const tools = buildHandler(fakeProvider).buildTools(ctxWith(ENABLED))
    expect(Object.keys(tools)).toContain('query_constituent_data')
    expect(Object.keys(tools)).toContain('describe_constituent_data')
  })

  it('omits them when the rollout flag is off', () => {
    const tools = buildHandler(fakeProvider).buildTools(
      ctxWith({ ...ENABLED, constituentToolEnabled: false }),
    )
    expect(Object.keys(tools)).not.toContain('query_constituent_data')
  })

  it('omits them when the district could not be resolved', () => {
    const tools = buildHandler(fakeProvider).buildTools(
      ctxWith({ ...ENABLED, districtFilters: null }),
    )
    expect(Object.keys(tools)).not.toContain('query_constituent_data')
  })

  it('omits them when no Databricks provider is configured', () => {
    const tools = buildHandler(undefined).buildTools(ctxWith(ENABLED))
    expect(Object.keys(tools)).not.toContain('query_constituent_data')
  })
})

const buildHandlerWithStory = (): CampaignManagerHandler =>
  new CampaignManagerHandler(
    {} as GeneralChatStoreService,
    {} as CampaignsService,
    {} as ChatStoreService,
    WIN_CONSTITUENT_TABLES,
    undefined,
    undefined,
    undefined,
    {} as CampaignStoryIntakeService,
  )

describe('CampaignManagerHandler.buildTools — campaign story tool', () => {
  it('registers campaign_story when the intake service + campaign are present', () => {
    const tools = buildHandlerWithStory().buildTools(
      ctxWith({ campaignId: 42 }),
    )
    expect(Object.keys(tools)).toContain('campaign_story')
  })

  it('omits campaign_story without a resolved campaign', () => {
    const tools = buildHandlerWithStory().buildTools(
      ctxWith({ campaignId: null }),
    )
    expect(Object.keys(tools)).not.toContain('campaign_story')
  })

  it('omits campaign_story when no intake service is wired', () => {
    const tools = buildHandler(undefined).buildTools(
      ctxWith({ campaignId: 42 }),
    )
    expect(Object.keys(tools)).not.toContain('campaign_story')
  })
})

describe('buildStoryGreeting', () => {
  const story = (missing: StoryState['missing']): StoryState => ({
    why: null,
    background: null,
    positions: [],
    complete: false,
    missing,
  })

  it('opens with the intro and the why question when nothing is answered', () => {
    const greeting = buildStoryGreeting(
      story(['why', 'background', 'positions']),
    )
    expect(greeting).toContain("Hi, I'm your campaign manager")
    expect(greeting).toContain('First, your why')
  })

  it('welcomes back and asks the next missing question when resuming', () => {
    const greeting = buildStoryGreeting(story(['background', 'positions']))
    expect(greeting).toContain('Welcome back')
    expect(greeting).toContain('Next, your background')
    expect(greeting).not.toContain('your why')
  })

  it('selects the first still-missing field as the question', () => {
    expect(buildStoryGreeting(story(['positions']))).toContain(
      'Next, your positions',
    )
  })
})

describe('CampaignManagerHandler — CRM contact tools (win-crm gating)', () => {
  const ORG = { slug: 'win-campaign' } as Organization

  const buildContacts = (): ContactsService =>
    ({
      getFilterDimensions: vi.fn(() => []),
      countContacts: vi.fn(),
    }) as unknown as ContactsService

  const buildCrmHandler = (
    contacts?: ContactsService,
  ): CampaignManagerHandler =>
    new CampaignManagerHandler(
      {} as GeneralChatStoreService,
      {} as CampaignsService,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
      undefined,
      undefined,
      undefined,
      undefined,
      contacts,
    )

  const CRM_ON = { organization: ORG, crmToolsEnabled: true }

  it('registers both tools when contacts service, org, and flag are present', () => {
    const tools = buildCrmHandler(buildContacts()).buildTools(ctxWith(CRM_ON))
    expect(Object.keys(tools)).toContain('describe_filter_dimensions')
    expect(Object.keys(tools)).toContain('count_contacts')
  })

  it('omits both when the win-crm flag is off', () => {
    const tools = buildCrmHandler(buildContacts()).buildTools(
      ctxWith({ ...CRM_ON, crmToolsEnabled: false }),
    )
    expect(Object.keys(tools)).not.toContain('count_contacts')
  })

  it('omits both when no organization resolved', () => {
    const tools = buildCrmHandler(buildContacts()).buildTools(
      ctxWith({ ...CRM_ON, organization: null }),
    )
    expect(Object.keys(tools)).not.toContain('count_contacts')
  })

  it('omits both when the contacts service is not wired', () => {
    const tools = buildCrmHandler(undefined).buildTools(ctxWith(CRM_ON))
    expect(Object.keys(tools)).not.toContain('count_contacts')
  })

  const buildLoadContextHandler = (enabledFlags: string[]) => {
    const store = {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'c1', organizationSlug: ORG.slug }),
      ),
    } as unknown as GeneralChatStoreService
    const campaigns = {
      client: {
        campaign: {
          findFirst: vi.fn(() =>
            Promise.resolve({ id: 5, details: {}, user: null }),
          ),
        },
        campaignTrackerTask: { findMany: vi.fn(() => Promise.resolve([])) },
        organization: { findFirst: vi.fn(() => Promise.resolve(ORG)) },
      },
    } as unknown as CampaignsService
    const features = {
      isFeatureEnabled: vi.fn(({ feature }: { feature: string }) =>
        Promise.resolve(enabledFlags.includes(feature)),
      ),
    } as unknown as FeaturesService
    const handler = new CampaignManagerHandler(
      store,
      campaigns,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
      undefined,
      undefined,
      features,
      undefined,
      buildContacts(),
    )
    return { handler, features }
  }

  it('loadContext enables the tools when win-crm AND win-voter-data are on', async () => {
    const { handler, features } = buildLoadContextHandler([
      'win-crm',
      'win-voter-data',
    ])

    const ctx = await handler.loadContext('c1', 7)

    expect(features.isFeatureEnabled).toHaveBeenCalledWith({
      user: 7,
      feature: 'win-crm',
    })
    expect(features.isFeatureEnabled).toHaveBeenCalledWith({
      user: 7,
      feature: 'win-voter-data',
    })
    expect(ctx.organization).toEqual(ORG)
    expect(ctx.crmToolsEnabled).toBe(true)
    expect(Object.keys(handler.buildTools(ctx))).toContain('count_contacts')
  })

  // Mirrors the webapp's useCrmEnabled invariant: win-crm alone must never
  // enable a Win org that isn't in the win-voter-data rollout.
  it('loadContext leaves the tools off when win-crm is on but win-voter-data is off', async () => {
    const { handler } = buildLoadContextHandler(['win-crm'])

    const ctx = await handler.loadContext('c1', 7)

    expect(ctx.crmToolsEnabled).toBe(false)
    expect(Object.keys(handler.buildTools(ctx))).not.toContain('count_contacts')
  })

  it('loadContext leaves the tools off when win-crm is off', async () => {
    const { handler } = buildLoadContextHandler(['win-voter-data'])

    const ctx = await handler.loadContext('c1', 7)

    expect(ctx.crmToolsEnabled).toBe(false)
    expect(Object.keys(handler.buildTools(ctx))).not.toContain('count_contacts')
  })
})

describe('CampaignManagerHandler.resolveConversation — single ongoing thread', () => {
  const buildHandlerWithStore = (
    store: Partial<GeneralChatStoreService>,
    chatStore: Partial<ChatStoreService>,
  ): CampaignManagerHandler =>
    new CampaignManagerHandler(
      store as GeneralChatStoreService,
      {} as CampaignsService,
      chatStore as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
    )

  const params = {
    scope: ChatScope.campaign_assistant,
    organizationSlug: 'org-slug',
  }

  it('resumes the latest conversation without creating or re-seeding it', async () => {
    const findLatestByScope = vi.fn().mockResolvedValue({ id: 'existing-1' })
    const createScopedConversation = vi.fn()
    const appendMessage = vi.fn()
    const handler = buildHandlerWithStore(
      { findLatestByScope, createScopedConversation },
      { appendMessage },
    )

    const res = await handler.resolveConversation(params, 42)

    expect(res).toEqual({ conversationId: 'existing-1', created: false })
    expect(findLatestByScope).toHaveBeenCalledWith({
      ownerUserId: 42,
      organizationSlug: 'org-slug',
      scope: ChatScope.campaign_assistant,
    })
    expect(createScopedConversation).not.toHaveBeenCalled()
    expect(appendMessage).not.toHaveBeenCalled()
  })

  it('creates and seeds a greeting when the candidate has no conversation yet', async () => {
    const findLatestByScope = vi.fn().mockResolvedValue(null)
    const createScopedConversation = vi.fn().mockResolvedValue({ id: 'new-1' })
    const appendMessage = vi.fn().mockResolvedValue(undefined)
    const handler = buildHandlerWithStore(
      { findLatestByScope, createScopedConversation },
      { appendMessage },
    )

    const res = await handler.resolveConversation(params, 42)

    expect(res).toEqual({ conversationId: 'new-1', created: true })
    expect(createScopedConversation).toHaveBeenCalledOnce()
    expect(appendMessage).toHaveBeenCalledOnce()
  })
})

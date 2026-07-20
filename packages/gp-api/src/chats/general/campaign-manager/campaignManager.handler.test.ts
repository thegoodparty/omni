import { describe, expect, it, vi } from 'vitest'
import {
  CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
  CAMPAIGN_MANAGER_START_STORY_SENTINEL,
} from '@goodparty_org/contracts'
import { ChatScope } from '../../../generated/prisma'
import type { CampaignsService } from '@/campaigns/services/campaigns.service'
import type { ChatStoreService } from '@/chats/services/chatStore.prisma'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { WIN_CONSTITUENT_TABLES } from './services/constituentDataScope'
import type { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import {
  buildCampaignManagerGreeting,
  buildStoryGreeting,
  CampaignManagerHandler,
} from './campaignManager.handler'
import type { CampaignManagerContext } from './campaignManagerPrompt'
import type {
  CampaignStoryIntakeService,
  StoryState,
} from './campaignStoryIntake.service'
import type { ContactsService } from '@/contacts/services/contacts.service'
import type { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
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
  savedFilterToolsEnabled: false,
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

describe('buildCampaignManagerGreeting', () => {
  it('interpolates the first name when present', () => {
    const greeting = buildCampaignManagerGreeting('Dana')
    expect(greeting).toContain("Hi Dana, I'm your Campaign Manager.")
    expect(greeting).toContain('How can I help today?')
  })

  it('falls back to the no-name variant when absent', () => {
    const greeting = buildCampaignManagerGreeting()
    expect(greeting).toContain("Hi, I'm your Campaign Manager.")
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
    expect(greeting).toContain('Before I build your plan and tracker')
    expect(greeting).toContain('First, your why')
    // No self-introduction: it must not re-greet after the general greeting on
    // the in-chat "Personalize" chip path.
    expect(greeting).not.toContain("I'm your campaign manager")
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
    voterFileFilters?: VoterFileFilterService,
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
      voterFileFilters,
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

  const buildVoterFileFilters = (): VoterFileFilterService =>
    ({
      findByOrganizationSlug: vi.fn(() => Promise.resolve([])),
    }) as unknown as VoterFileFilterService

  it('registers crud_saved_filters only with the filter service and its flag', () => {
    const withWrites = buildCrmHandler(
      buildContacts(),
      buildVoterFileFilters(),
    ).buildTools(ctxWith({ ...CRM_ON, savedFilterToolsEnabled: true }))
    expect(Object.keys(withWrites)).toContain('crud_saved_filters')

    const noService = buildCrmHandler(buildContacts()).buildTools(
      ctxWith({ ...CRM_ON, savedFilterToolsEnabled: true }),
    )
    expect(Object.keys(noService)).not.toContain('crud_saved_filters')

    const flagOff = buildCrmHandler(
      buildContacts(),
      buildVoterFileFilters(),
    ).buildTools(ctxWith(CRM_ON))
    expect(Object.keys(flagOff)).not.toContain('crud_saved_filters')
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
      buildVoterFileFilters(),
    )
    return { handler, features }
  }

  it('loadContext enables the tools when win-crm is on', async () => {
    const { handler, features } = buildLoadContextHandler(['win-crm'])

    const ctx = await handler.loadContext('c1', 7)

    expect(features.isFeatureEnabled).toHaveBeenCalledWith({
      user: 7,
      feature: 'win-crm',
    })
    expect(ctx.organization).toEqual(ORG)
    expect(ctx.crmToolsEnabled).toBe(true)
    expect(ctx.savedFilterToolsEnabled).toBe(true)
    const toolNames = Object.keys(handler.buildTools(ctx))
    expect(toolNames).toContain('count_contacts')
    expect(toolNames).toContain('crud_saved_filters')
  })

  it('loadContext leaves the tools off when win-crm is off', async () => {
    const { handler } = buildLoadContextHandler([])

    const ctx = await handler.loadContext('c1', 7)

    expect(ctx.crmToolsEnabled).toBe(false)
    expect(ctx.savedFilterToolsEnabled).toBe(false)
    const toolNames = Object.keys(handler.buildTools(ctx))
    expect(toolNames).not.toContain('count_contacts')
    expect(toolNames).not.toContain('crud_saved_filters')
  })
})

describe('CampaignManagerHandler.resolveConversation — single ongoing thread', () => {
  const buildHandlerWithStore = (
    store: Partial<GeneralChatStoreService>,
    chatStore: Partial<ChatStoreService>,
  ): CampaignManagerHandler =>
    new CampaignManagerHandler(
      store as GeneralChatStoreService,
      // resolveGreeting fetches the campaign for the first name; a null result
      // makes it fall back to the no-name general greeting (no throw).
      {
        findFirst: vi.fn().mockResolvedValue(null),
      } as unknown as CampaignsService,
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

  it('seeds the general greeting even when the Campaign Story is incomplete', async () => {
    const findLatestByScope = vi.fn().mockResolvedValue(null)
    const createScopedConversation = vi.fn().mockResolvedValue({ id: 'new-2' })
    const appendMessage = vi.fn().mockResolvedValue(undefined)
    const findFirst = vi
      .fn()
      .mockResolvedValue({ id: 1, user: { firstName: 'Dana' } })
    const read = vi.fn().mockResolvedValue({
      why: null,
      background: null,
      positions: [],
      complete: false,
      missing: ['why', 'background', 'positions'],
    } satisfies StoryState)
    const handler = new CampaignManagerHandler(
      {
        findLatestByScope,
        createScopedConversation,
      } as unknown as GeneralChatStoreService,
      { findFirst } as unknown as CampaignsService,
      { appendMessage } as unknown as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
      undefined,
      undefined,
      undefined,
      { read } as unknown as CampaignStoryIntakeService,
    )

    await handler.resolveConversation(params, 42)

    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationSlug: 'org-slug' },
      include: { user: true },
    })
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: buildCampaignManagerGreeting('Dana'),
      }),
    )
  })
})

describe('CampaignManagerHandler.maybeCannedReply', () => {
  const buildHandler = (): CampaignManagerHandler =>
    new CampaignManagerHandler(
      {} as GeneralChatStoreService,
      {} as CampaignsService,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
    )

  const incompleteStory: StoryState = {
    why: null,
    background: null,
    positions: [],
    complete: false,
    missing: ['why', 'background', 'positions'],
  }

  const completeStory: StoryState = {
    why: 'why',
    background: 'background',
    positions: [{ title: 'a' }, { title: 'b' }],
    complete: true,
    missing: [],
  }

  const PRODUCT_OVERVIEW_OPENER =
    "I'm your campaign manager, here to help you run and win."

  it('returns the story-intake opener when the sentinel arrives mid-intake', () => {
    const reply = buildHandler().maybeCannedReply(
      CAMPAIGN_MANAGER_START_STORY_SENTINEL,
      ctxWith({ story: incompleteStory }),
    )
    expect(reply).toBe(buildStoryGreeting(incompleteStory))
  })

  it('returns the canned "already complete" line when the story is done', () => {
    const reply = buildHandler().maybeCannedReply(
      CAMPAIGN_MANAGER_START_STORY_SENTINEL,
      ctxWith({ story: completeStory }),
    )
    expect(reply).toBe(
      'Your Campaign Story is all set. Tell me what you would like to ' +
        'change and I can help you refine it.',
    )
  })

  it('returns null for a non-sentinel message', () => {
    const reply = buildHandler().maybeCannedReply(
      'hello',
      ctxWith({ story: incompleteStory }),
    )
    expect(reply).toBeNull()
  })

  it('falls back to the intake opener when no campaign context loaded', () => {
    const reply = buildHandler().maybeCannedReply(
      CAMPAIGN_MANAGER_START_STORY_SENTINEL,
      ctxWith({ story: null }),
    )
    expect(reply).not.toBeNull()
    expect(reply).toBe(
      buildStoryGreeting({
        why: null,
        background: null,
        positions: [],
        complete: false,
        missing: ['why', 'background', 'positions'],
      }),
    )
  })

  it('returns the product overview when the story has not loaded', () => {
    const reply = buildHandler().maybeCannedReply(
      CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
      ctxWith({ story: null }),
    )
    expect(reply).toContain(PRODUCT_OVERVIEW_OPENER)
  })

  it('returns the product overview when the story is incomplete', () => {
    const reply = buildHandler().maybeCannedReply(
      CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
      ctxWith({ story: incompleteStory }),
    )
    expect(reply).toContain(PRODUCT_OVERVIEW_OPENER)
  })

  it('returns the product overview when the story is complete', () => {
    const reply = buildHandler().maybeCannedReply(
      CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
      ctxWith({ story: completeStory }),
    )
    expect(reply).toContain(PRODUCT_OVERVIEW_OPENER)
  })
})

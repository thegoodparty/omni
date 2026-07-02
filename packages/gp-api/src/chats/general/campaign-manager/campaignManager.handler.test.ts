import { describe, expect, it, vi } from 'vitest'
import { ChatScope } from '../../../generated/prisma'
import type { CampaignsService } from '@/campaigns/services/campaigns.service'
import type { ChatStoreService } from '@/chats/services/chatStore.prisma'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { CONSTITUENT_TABLES } from '../chief-of-staff/services/constituentDataScope'
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

const fakeProvider = { query: vi.fn() } as unknown as DatabricksProvider

const buildHandler = (provider?: DatabricksProvider): CampaignManagerHandler =>
  new CampaignManagerHandler(
    {} as GeneralChatStoreService,
    {} as CampaignsService,
    {} as ChatStoreService,
    CONSTITUENT_TABLES,
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
  story: null,
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
    CONSTITUENT_TABLES,
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

describe('CampaignManagerHandler.resolveConversation — single ongoing thread', () => {
  const buildHandlerWithStore = (
    store: Partial<GeneralChatStoreService>,
    chatStore: Partial<ChatStoreService>,
  ): CampaignManagerHandler =>
    new CampaignManagerHandler(
      store as GeneralChatStoreService,
      {} as CampaignsService,
      chatStore as ChatStoreService,
      CONSTITUENT_TABLES,
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

import { describe, expect, it, vi } from 'vitest'
import type { CampaignsService } from '@/campaigns/services/campaigns.service'
import type { ChatStoreService } from '@/chats/services/chatStore.prisma'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { CONSTITUENT_TABLES } from '../chief-of-staff/services/constituentDataScope'
import type { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import { CampaignManagerHandler } from './campaignManager.handler'
import type { CampaignManagerContext } from './campaignManagerPrompt'
import type { CampaignStoryIntakeService } from './campaignStoryIntake.service'

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

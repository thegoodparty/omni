import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
  CAMPAIGN_MANAGER_START_STORY_SENTINEL,
} from '@goodparty_org/contracts'
import { ChatMessageRole, ChatScope } from '../../../generated/prisma'
import type { CampaignsService } from '@/campaigns/services/campaigns.service'
import type { ChatStoreService } from '@/chats/services/chatStore.prisma'
import { DATA_SOURCE_ROUTING_RULES } from '@/llm/tools/dataSourceRouting'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import type { ConstituentTableConfig } from '../chief-of-staff/services/constituentDataScope'
import { WIN_CONSTITUENT_TABLES } from './services/constituentDataScope'
import type { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import type { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import type { HelpCenterSearchService } from '../help-center/helpCenterSearch.service'
import {
  buildCampaignManagerGreeting,
  buildStoryGreeting,
  CampaignManagerHandler,
} from './campaignManager.handler'
import type { CampaignManagerContext } from './campaignManagerPrompt'
import type { CampaignStoryIntakeService } from './campaignStoryIntake.service'
import type { StoryState } from '@/campaignStory/services/campaignStoryState.service'
import type { ContactsService } from '@/contacts/services/contacts.service'
import type { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import type { ElectionsService } from '@/elections/services/elections.service'
import type { RaceTargetMetrics } from '@/elections/types/elections.types'
import type { LlmTool } from '@/llm/services/llm.service'
import type { Organization } from '../../../generated/prisma'
import { LEGAL_LINE } from './campaignManagerPrompt'
import { guardrailLine } from '../services/guardrailLines'
import type { PriorityFlowOutreachService } from '../priority-flow/services/priorityFlowOutreach.service'
import type { PinoLogger } from 'nestjs-pino'
import type { PublicProfileAddressService } from '@/personProfiles/services/public-profile-address.service'

const fakeProvider = { query: vi.fn() } as unknown as DatabricksProvider

// Native web search has no description; every other registered tool does.
const descriptionOf = (tool: LlmTool | undefined): string => {
  if (!tool || !('description' in tool)) {
    throw new Error('expected a tool with a description')
  }
  return tool.description
}

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
  district: null,
  officeLevel: null,
  location: null,
  electionDate: null,
  primaryElectionDate: null,
  primaryResult: null,
  didWin: null,
  smsCompliance: null,
  smsCutoffDate: null,
  liveRace: { status: 'none', reason: 'no-race' },
  ballotStatus: null,
  filingPeriodStart: null,
  filingPeriodEnd: null,
  topTasks: [],
  districtFilters: null,
  constituentToolEnabled: false,
  organization: null,
  crmToolsEnabled: false,
  savedFilterToolsEnabled: false,
  raceId: null,
  webSearchEnabled: true,
  helpCenterToolEnabled: false,
  isPro: null,
  story: null,
  plan: null,
  publicProfile: { status: 'not-live' },
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

  it('registers mart tools whose descriptions carry the shared routing rules', () => {
    const tools = buildHandler(fakeProvider).buildTools(ctxWith(ENABLED))
    expect(descriptionOf(tools.query_constituent_data)).toContain(
      DATA_SOURCE_ROUTING_RULES,
    )
    expect(descriptionOf(tools.describe_constituent_data)).toContain(
      DATA_SOURCE_ROUTING_RULES,
    )
  })

  // The rows are scoped to the district, so the district's state decides
  // how party is described, not the state typed on the campaign record.
  it('describes party by the state the district is in', async () => {
    const tools = buildHandler(fakeProvider).buildTools(
      ctxWith({ ...ENABLED, state: 'CA', districtState: 'MN' }),
    )
    const tool = tools.describe_constituent_data
    if (!tool || !('execute' in tool)) {
      throw new Error('expected describe_constituent_data to register')
    }
    const meta = await tool.execute({})
    if (typeof meta !== 'object' || meta === null || !('dimensions' in meta)) {
      throw new Error('expected a dimensions payload')
    }
    expect(meta.dimensions).toContainEqual({
      name: 'Parties_Description',
      label: 'Party as the vendor assigns it, not a registration',
    })
    expect(descriptionOf(tools.query_constituent_data)).toContain(
      'Minnesota provides no party information in its voter file.',
    )
  })
})

describe('CampaignManagerHandler.loadContext — constituent tool gating', () => {
  const ORG_SLUG = 'win-campaign'

  const buildResolvingDistrictResolver = (): DistrictResolverService =>
    ({
      resolveByOrgSlug: vi.fn(() =>
        Promise.resolve({
          state: 'IL',
          l2DistrictType: 'city',
          l2DistrictName: 'Springfield',
        }),
      ),
      toMandatoryFilters: vi.fn(() => [
        { column: 'state_postal_code', value: 'IL' },
        { column: 'City', value: 'Springfield' },
      ]),
    }) as unknown as DistrictResolverService

  const buildContextHandler = (
    provider: DatabricksProvider | undefined,
    tables: ConstituentTableConfig[],
    districtResolver?: DistrictResolverService,
  ): CampaignManagerHandler => {
    const store = {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'c1', organizationSlug: ORG_SLUG }),
      ),
    } as unknown as GeneralChatStoreService
    const campaigns = {
      client: {
        campaign: {
          findFirst: vi.fn(() =>
            Promise.resolve({ id: 5, details: {}, data: {}, user: null }),
          ),
        },
        campaignTrackerTask: { findMany: vi.fn(() => Promise.resolve([])) },
        organization: { findFirst: vi.fn(() => Promise.resolve(null)) },
      },
    } as unknown as CampaignsService
    return new CampaignManagerHandler(
      store,
      campaigns,
      {} as ChatStoreService,
      tables,
      provider,
      districtResolver,
    )
  }

  it('enables the constituent tool when provider + tables + district resolve', async () => {
    const handler = buildContextHandler(
      fakeProvider,
      WIN_CONSTITUENT_TABLES,
      buildResolvingDistrictResolver(),
    )
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.constituentToolEnabled).toBe(true)
  })

  it('disables the constituent tool without a provider', async () => {
    const handler = buildContextHandler(
      undefined,
      WIN_CONSTITUENT_TABLES,
      buildResolvingDistrictResolver(),
    )
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.constituentToolEnabled).toBe(false)
  })

  it('disables the constituent tool when no table is configured', async () => {
    const handler = buildContextHandler(
      fakeProvider,
      [],
      buildResolvingDistrictResolver(),
    )
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.constituentToolEnabled).toBe(false)
  })

  it('disables the constituent tool when the district does not resolve', async () => {
    const handler = buildContextHandler(fakeProvider, WIN_CONSTITUENT_TABLES)
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.constituentToolEnabled).toBe(false)
  })
})

// The flag the product map's status line reads. Taken from the campaign row
// the handler already loads, and absent means not Pro, the same rule the
// contacts service applies when it gates a filter.
describe('CampaignManagerHandler.loadContext (Pro status)', () => {
  // The columns loadContext reads off the campaign row, so a typo here fails
  // to compile instead of silently building a different context.
  type CampaignRowLike = {
    id: number
    details: object
    data: object
    user: null
    isPro?: boolean | null
  }
  const buildHandlerForRow = (
    row: CampaignRowLike | null,
  ): CampaignManagerHandler => {
    const store = {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'c1', organizationSlug: 'win-campaign' }),
      ),
    } as unknown as GeneralChatStoreService
    const campaigns = {
      client: {
        campaign: { findFirst: vi.fn(() => Promise.resolve(row)) },
        campaignTrackerTask: { findMany: vi.fn(() => Promise.resolve([])) },
        organization: { findFirst: vi.fn(() => Promise.resolve(null)) },
      },
    } as unknown as CampaignsService
    return new CampaignManagerHandler(
      store,
      campaigns,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
    )
  }

  it("carries the row's Pro flag into the context", async () => {
    const handler = buildHandlerForRow({
      id: 5,
      details: {},
      data: {},
      user: null,
      isPro: true,
    })
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.isPro).toBe(true)
  })

  it('treats a row without the flag as not Pro', async () => {
    const handler = buildHandlerForRow({
      id: 5,
      details: {},
      data: {},
      user: null,
    })
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.isPro).toBe(false)
  })

  // Unknown is a third state, not "no": the map then says nothing about Pro
  // rather than telling a campaign it may well have that it is locked out.
  it('leaves the flag unknown when the campaign does not resolve', async () => {
    const handler = buildHandlerForRow(null)
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.isPro).toBeNull()
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
    {} as CampaignStoryIntakeService,
  )

describe('CampaignManagerHandler.loadContext — public profile address', () => {
  const ORG_SLUG = 'win-campaign'
  const URL = 'https://goodparty.org/people/renee-diaz-0189abcd'
  const GATE = {
    personId: '0189abcd-0000-7000-8000-000000000000',
    publishedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
  }
  // The conversation owner (7) and the campaign's own user (9) differ on
  // purpose: the profile belongs to the candidate, whoever is chatting.
  const CAMPAIGN_ROW = {
    id: 5,
    userId: 9,
    details: { state: 'IL' },
    data: {},
    user: { id: 9, firstName: 'Renee', lastName: 'Diaz', personProfile: GATE },
  }

  type CampaignRow = Omit<typeof CAMPAIGN_ROW, 'user'> & {
    user: Omit<(typeof CAMPAIGN_ROW)['user'], 'personProfile'> & {
      personProfile: typeof GATE | null
    }
  }

  const buildAddressHandler = (
    publicProfiles?: PublicProfileAddressService,
    campaignRow: CampaignRow | null = CAMPAIGN_ROW,
  ): CampaignManagerHandler => {
    const store = {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'c1', organizationSlug: ORG_SLUG }),
      ),
    } as unknown as GeneralChatStoreService
    const campaigns = {
      client: {
        campaign: { findFirst: vi.fn(() => Promise.resolve(campaignRow)) },
        campaignTrackerTask: { findMany: vi.fn(() => Promise.resolve([])) },
        organization: { findFirst: vi.fn(() => Promise.resolve(null)) },
      },
    } as unknown as CampaignsService
    return new CampaignManagerHandler(
      store,
      campaigns,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      publicProfiles,
    )
  }

  it("carries the address resolved from the campaign user's own gate, for the local day", async () => {
    const resolve = vi.fn(() =>
      Promise.resolve({ status: 'live' as const, url: URL }),
    )
    const handler = buildAddressHandler({
      resolve,
    } as unknown as PublicProfileAddressService)
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.publicProfile).toEqual({ status: 'live', url: URL })
    expect(resolve).toHaveBeenCalledWith(
      GATE,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    )
  })

  it('passes a null gate when the campaign user has no profile row', async () => {
    const resolve = vi.fn(() =>
      Promise.resolve({ status: 'not-live' as const }),
    )
    const handler = buildAddressHandler(
      { resolve } as unknown as PublicProfileAddressService,
      { ...CAMPAIGN_ROW, user: { ...CAMPAIGN_ROW.user, personProfile: null } },
    )
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.publicProfile).toEqual({ status: 'not-live' })
    expect(resolve).toHaveBeenCalledWith(
      null,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    )
  })

  it('reads unknown when no service is wired', async () => {
    const ctx = await buildAddressHandler(undefined).loadContext('c1', 7)
    expect(ctx.publicProfile).toEqual({ status: 'unknown' })
  })

  it('reads unknown, not not-live, when the lookup throws', async () => {
    const handler = buildAddressHandler({
      resolve: vi.fn(() => Promise.reject(new Error('election-api down'))),
    } as unknown as PublicProfileAddressService)
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.publicProfile).toEqual({ status: 'unknown' })
  })

  it('reads unknown when the lookup outlives the turn timer', async () => {
    vi.useFakeTimers()
    try {
      const handler = buildAddressHandler({
        resolve: vi.fn(
          () =>
            new Promise(() => {
              // Never settles: the handler's timer must give up first.
            }),
        ),
      } as unknown as PublicProfileAddressService)
      const pending = handler.loadContext('c1', 7)
      // The handler's lookup timer (LIVE_RACE_TIMEOUT_MS) is 3 s.
      await vi.advanceTimersByTimeAsync(3_100)
      expect((await pending).publicProfile).toEqual({ status: 'unknown' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads unknown when the campaign does not resolve', async () => {
    const handler = buildAddressHandler(
      {
        resolve: vi.fn(() =>
          Promise.resolve({ status: 'live' as const, url: URL }),
        ),
      } as unknown as PublicProfileAddressService,
      null,
    )
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.publicProfile).toEqual({ status: 'unknown' })
  })
})

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

// The handler guards this tool on TWO things — the injected service AND the
// ctx flag — and the tool's own unit tests cannot reach either. Without these,
// hardcoding helpCenterToolEnabled to false or mis-wiring the provider would
// leave every other test green.
// The flag buildTools reads is derived in loadContext, so a buildTools test
// that hands in its own context cannot see it go wrong. This is the half that
// catches the flag being stuck, or the service never being injected.
describe('CampaignManagerHandler.loadContext — help center gating', () => {
  const buildHelpCenterContextHandler = (
    helpCenter?: HelpCenterSearchService,
  ): CampaignManagerHandler => {
    const store = {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'c1', organizationSlug: 'win-campaign' }),
      ),
    } as unknown as GeneralChatStoreService
    const campaigns = {
      client: {
        campaign: {
          findFirst: vi.fn(() =>
            Promise.resolve({ id: 5, details: {}, data: {}, user: null }),
          ),
        },
        campaignTrackerTask: { findMany: vi.fn(() => Promise.resolve([])) },
        organization: { findFirst: vi.fn(() => Promise.resolve(null)) },
      },
    } as unknown as CampaignsService
    return new CampaignManagerHandler(
      store,
      campaigns,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      helpCenter,
    )
  }

  it('enables the help center whenever the service is injected', async () => {
    const handler = buildHelpCenterContextHandler({} as HelpCenterSearchService)
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.helpCenterToolEnabled).toBe(true)
  })

  it('disables the help center when no service is injected', async () => {
    const handler = buildHelpCenterContextHandler(undefined)
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.helpCenterToolEnabled).toBe(false)
  })

  // Help-center search needs no campaign and no credential, so it must
  // survive a context that could not resolve one.
  it('keeps the help center enabled when the campaign does not resolve', async () => {
    const store = {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'c1', organizationSlug: null }),
      ),
    } as unknown as GeneralChatStoreService
    const handler = new CampaignManagerHandler(
      store,
      {} as CampaignsService,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {} as HelpCenterSearchService,
    )
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.helpCenterToolEnabled).toBe(true)
  })
})

describe('CampaignManagerHandler.buildTools — help center tool', () => {
  const buildHelpCenterHandler = (
    helpCenter?: HelpCenterSearchService,
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
      undefined,
      undefined,
      helpCenter,
    )

  it('registers search_help_center when the service is wired and enabled', () => {
    const tools = buildHelpCenterHandler(
      {} as HelpCenterSearchService,
    ).buildTools(ctxWith({ helpCenterToolEnabled: true }))
    expect(Object.keys(tools)).toContain('search_help_center')
  })

  it('omits search_help_center when the context has it disabled', () => {
    const tools = buildHelpCenterHandler(
      {} as HelpCenterSearchService,
    ).buildTools(ctxWith({ helpCenterToolEnabled: false }))
    expect(Object.keys(tools)).not.toContain('search_help_center')
  })

  it('omits search_help_center when no service is wired', () => {
    const tools = buildHelpCenterHandler(undefined).buildTools(
      ctxWith({ helpCenterToolEnabled: true }),
    )
    expect(Object.keys(tools)).not.toContain('search_help_center')
  })
})

describe('CampaignManagerHandler.describePage', () => {
  it('names the Win page a message was sent from', () => {
    const block = buildHandler().describePage('/dashboard/contacts/lists/3')
    expect(block).toContain('CURRENT PAGE')
    expect(block).toContain('Voter Data (/dashboard/contacts)')
  })

  it('says nothing for a path the product map does not know', () => {
    expect(buildHandler().describePage('/dashboard/not-a-page')).toBeNull()
    expect(buildHandler().describePage('/dashboard/briefings')).toBeNull()
  })
})

describe('CampaignManagerHandler.buildTools — past outreach', () => {
  const withOutreach = () =>
    new CampaignManagerHandler(
      {} as GeneralChatStoreService,
      {} as CampaignsService,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {} as PriorityFlowOutreachService,
    )

  it("reads and shows the campaign's sends once its campaign resolves", () => {
    const names = Object.keys(
      withOutreach().buildTools(ctxWith({ campaignId: 42 })),
    )
    expect(names).toContain('read_past_outreach')
    expect(names).toContain('present_past_outreach')
  })

  it('stays off without a campaign to scope the sends to', () => {
    const names = Object.keys(withOutreach().buildTools(ctxWith({})))
    expect(names).not.toContain('read_past_outreach')
    expect(names).not.toContain('present_past_outreach')
  })

  it('reads door and call notes only with issue capture on', () => {
    const on = withOutreach().buildTools(
      ctxWith({ campaignId: 42, outreachFeedbackEnabled: true }),
    )
    const description = descriptionOf(on.read_outreach_feedback)
    expect(description).toContain('voters')
    expect(description).not.toContain('constituent')
    expect(
      Object.keys(withOutreach().buildTools(ctxWith({ campaignId: 42 }))),
    ).not.toContain('read_outreach_feedback')
    expect(
      Object.keys(
        withOutreach().buildTools(ctxWith({ outreachFeedbackEnabled: true })),
      ),
    ).not.toContain('read_outreach_feedback')
  })
})

describe('CampaignManagerHandler.buildTools — ask_clarify_question', () => {
  it('registers ask_clarify_question', () => {
    const tools = buildHandler().buildTools(ctxWith({}))
    expect(Object.keys(tools)).toContain('ask_clarify_question')
  })
})

describe('CampaignManagerHandler.buildTools — compose_handoff', () => {
  it('registers compose_handoff', () => {
    const tools = buildHandler().buildTools(ctxWith({}))
    expect(Object.keys(tools)).toContain('compose_handoff')
  })

  it("the registered tool's input schema accepts only win_social", async () => {
    const tools = buildHandler().buildTools(ctxWith({}))
    const tool = tools.compose_handoff
    if (!tool || !('execute' in tool)) {
      throw new Error('expected compose_handoff to register with execute')
    }
    const result = await tool.execute({
      channel: 'win_social',
      draftText: 'hello voters',
    })
    expect(result).toEqual({
      channel: 'win_social',
      draftText: 'hello voters',
    })
    expect(() =>
      tool.execute({
        channel: 'serve_social',
        draftText: 'hello constituents',
      }),
    ).toThrow()
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
    expect(greeting).toContain('Before I build your campaign and outreach plan')
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

describe('CampaignManagerHandler — CRM contact tools gating', () => {
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
      contacts,
      voterFileFilters,
    )

  const CRM_ON = { organization: ORG, crmToolsEnabled: true, isPro: true }

  it('registers both tools when contacts service, org, and flag are present', () => {
    const tools = buildCrmHandler(buildContacts()).buildTools(ctxWith(CRM_ON))
    expect(Object.keys(tools)).toContain('describe_filter_dimensions')
    expect(Object.keys(tools)).toContain('count_contacts')
  })

  it('registers CRM tools whose descriptions carry the shared routing rules', () => {
    const tools = buildCrmHandler(buildContacts()).buildTools(ctxWith(CRM_ON))
    expect(descriptionOf(tools.describe_filter_dimensions)).toContain(
      DATA_SOURCE_ROUTING_RULES,
    )
    expect(descriptionOf(tools.count_contacts)).toContain(
      DATA_SOURCE_ROUTING_RULES,
    )
  })

  // A free campaign can count, size and be shown a text card (the card's
  // button is its Pro gate); only the tools whose services refuse it stay
  // Pro.
  it('lets a campaign without Pro count and present, but not manage lists', () => {
    const tools = buildCrmHandler(
      buildContacts(),
      buildVoterFileFilters(),
    ).buildTools(
      ctxWith({
        ...CRM_ON,
        isPro: false,
        savedFilterToolsEnabled: true,
      }),
    )

    for (const name of [
      'describe_filter_dimensions',
      'count_contacts',
      'size_outreach_sample',
      'present_outreach_proposal',
    ]) {
      expect(Object.keys(tools)).toContain(name)
    }
    for (const name of [
      'list_precincts',
      'crud_saved_filters',
      'show_list_map',
    ]) {
      expect(Object.keys(tools)).not.toContain(name)
    }
  })

  // Only a known "no" gates. Unknown keeps every tool and leaves the decision
  // to the service, so the gate can never fail closed on a campaign that
  // does have access.
  it('keeps every CRM tool when Pro status is unknown', () => {
    const tools = buildCrmHandler(
      buildContacts(),
      buildVoterFileFilters(),
    ).buildTools(
      ctxWith({ ...CRM_ON, isPro: null, savedFilterToolsEnabled: true }),
    )
    for (const name of [
      'describe_filter_dimensions',
      'count_contacts',
      'list_precincts',
      'crud_saved_filters',
      'show_list_map',
    ]) {
      expect(Object.keys(tools)).toContain(name)
    }
  })

  it('names both filter tools in the catalog when saved lists are on', () => {
    const tools = buildCrmHandler(
      buildContacts(),
      buildVoterFileFilters(),
    ).buildTools(ctxWith({ ...CRM_ON, savedFilterToolsEnabled: true }))
    expect(
      descriptionOf(tools.describe_filter_dimensions).split('\n\n')[0],
    ).toContain('for count_contacts or crud_saved_filters')
  })

  it('names the count tool alone in the catalog when saved lists are off', () => {
    const tools = buildCrmHandler(buildContacts()).buildTools(ctxWith(CRM_ON))
    const line = descriptionOf(tools.describe_filter_dimensions).split(
      '\n\n',
    )[0]
    expect(line).toContain('for count_contacts')
    expect(line).not.toContain('crud_saved_filters')
  })

  it('omits both when crmToolsEnabled is false', () => {
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
    expect(Object.keys(withWrites)).toContain('size_outreach_sample')
    expect(Object.keys(withWrites)).toContain('present_outreach_proposal')
    expect(Object.keys(withWrites)).toContain('present_list_proposal')

    const noService = buildCrmHandler(buildContacts()).buildTools(
      ctxWith({ ...CRM_ON, savedFilterToolsEnabled: true }),
    )
    expect(Object.keys(noService)).not.toContain('crud_saved_filters')
    expect(Object.keys(noService)).not.toContain('size_outreach_sample')
    expect(Object.keys(noService)).not.toContain('present_outreach_proposal')
    expect(Object.keys(noService)).not.toContain('present_list_proposal')

    const flagOff = buildCrmHandler(
      buildContacts(),
      buildVoterFileFilters(),
    ).buildTools(ctxWith(CRM_ON))
    expect(Object.keys(flagOff)).not.toContain('crud_saved_filters')
    expect(Object.keys(flagOff)).not.toContain('size_outreach_sample')
    expect(Object.keys(flagOff)).not.toContain('present_outreach_proposal')
    expect(Object.keys(flagOff)).not.toContain('present_list_proposal')
  })

  it('offers a list card to a campaign without Pro, in candidate words', async () => {
    const tools = buildCrmHandler(
      buildContacts(),
      buildVoterFileFilters(),
    ).buildTools(
      ctxWith({ ...CRM_ON, savedFilterToolsEnabled: true, isPro: false }),
    )
    expect(Object.keys(tools)).not.toContain('crud_saved_filters')
    const tool = tools.present_list_proposal
    if (!tool || 'kind' in tool) throw new Error('not registered')
    const card = {
      name: 'East side renters',
      summary: 'Renters on the east side.',
      filters: { homeownerNo: true },
    }

    expect(await tool.execute({ ...card, count: 1200 })).toEqual({
      presented: true,
    })
    expect(await tool.execute({ ...card, count: 0 })).toEqual({
      error: expect.stringContaining('counted nobody'),
    })
    expect(descriptionOf(tool)).toContain('Voter Data')
    expect(descriptionOf(tool)).toContain('draw shapes')
  })

  it('presents every channel as a card in candidate words', async () => {
    const tools = buildCrmHandler(
      buildContacts(),
      buildVoterFileFilters(),
    ).buildTools(ctxWith({ ...CRM_ON, savedFilterToolsEnabled: true }))
    const tool = tools.present_outreach_proposal
    if (!tool || 'kind' in tool) throw new Error('not registered')
    const proposal = {
      audience: 'Renters on the east side',
      count: 1200,
      listName: 'East side renters',
      message: 'this is Renee, candidate for City Council. What matters?',
    }

    expect(await tool.execute({ ...proposal, channel: 'text' })).toEqual({
      presented: true,
      deepLinkOnly: true,
    })
    expect(
      await tool.execute({ ...proposal, channel: 'phoneBanking' }),
    ).toEqual({ presented: true, deepLinkOnly: false })
    for (const channel of ['doorKnocking', 'social']) {
      expect(await tool.execute({ ...proposal, channel })).toEqual({
        presented: true,
        deepLinkOnly: true,
      })
    }
    expect(descriptionOf(tool)).not.toContain('official')
    expect(descriptionOf(tool)).not.toContain('constituent')
  })

  describe('SMS compliance cutoff', () => {
    const proposal = {
      audience: 'Renters on the east side',
      count: 1200,
      listName: 'East side renters',
      message: 'this is Renee, candidate for City Council. What matters?',
    }
    const outreachTools = (smsCompliance: 'closed' | 'open') => {
      const tools = buildCrmHandler(
        buildContacts(),
        buildVoterFileFilters(),
      ).buildTools(
        ctxWith({
          ...CRM_ON,
          savedFilterToolsEnabled: true,
          smsCompliance,
          smsCutoffDate: '2026-10-15',
        }),
      )
      const present = tools.present_outreach_proposal
      const size = tools.size_outreach_sample
      if (!present || 'kind' in present || !size || 'kind' in size) {
        throw new Error('not registered')
      }
      return { present, size }
    }

    it('refuses a text card and a text sample when texting is closed', async () => {
      const { present, size } = outreachTools('closed')
      expect(await present.execute({ ...proposal, channel: 'text' })).toEqual({
        error: expect.stringContaining('Texting is closed for this race'),
      })
      expect(await size.execute({ audience: 50_000 })).toEqual({
        error: expect.stringContaining('Texting is closed for this race'),
      })
      for (const channel of ['phoneBanking', 'doorKnocking', 'social']) {
        expect(await present.execute({ ...proposal, channel })).toMatchObject({
          presented: true,
        })
      }
    })

    it('presents and sizes a text when texting is open', async () => {
      const { present, size } = outreachTools('open')
      expect(await present.execute({ ...proposal, channel: 'text' })).toEqual({
        presented: true,
        deepLinkOnly: true,
      })
      expect(await size.execute({ audience: 50_000 })).toMatchObject({
        sampleSize: 2_767,
      })
    })

    it('leaves texting out of the product overview only when closed', () => {
      const closed = buildHandler().maybeCannedReply(
        CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
        ctxWith({ smsCompliance: 'closed' }),
      )
      expect(closed).not.toContain('texting')
      expect(closed).toContain('robocalls, door-knocking scripts')
      const open = buildHandler().maybeCannedReply(
        CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
        ctxWith({ smsCompliance: 'open' }),
      )
      expect(open).toContain('texting, door-knocking scripts')
    })
  })

  it('names the registered card tools in the prompt it builds', () => {
    const handler = buildCrmHandler(buildContacts(), buildVoterFileFilters())
    const withCard = handler.buildSystemPrompt(
      ctxWith({ ...CRM_ON, savedFilterToolsEnabled: true }),
    )
    expect(withCard).toContain('SAMPLING RULES')
    expect(withCard).toContain('present_outreach_proposal')

    const withoutCard = handler.buildSystemPrompt(ctxWith(CRM_ON))
    expect(withoutCard).not.toContain('SAMPLING RULES')
    expect(withoutCard).not.toContain('present_outreach_proposal')
  })

  const buildBallotHandler = (
    elections?: ElectionsService,
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
      undefined,
      elections,
    )

  const ELECTIONS = {
    fetchFilingFeeByRaceHash: vi.fn(() => Promise.resolve(null)),
  } as unknown as ElectionsService

  // details is untyped JSON at the read site, so an unparseable date must not
  // reach the prompt as NaN -- it would slip past every null-guard downstream.
  it('passes the stored dates and results through as the record holds them', async () => {
    const store = {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'c1', organizationSlug: ORG.slug }),
      ),
    } as unknown as GeneralChatStoreService
    const campaigns = {
      client: {
        campaign: {
          findFirst: vi.fn(() =>
            Promise.resolve({
              id: 5,
              details: {
                electionDate: '2026-11-03',
                primaryElectionDate: '2026-05-19',
                filingPeriodsStart: '2025-11-05',
                filingPeriodsEnd: '2026-01-09',
              },
              primaryResult: 'lost',
              didWin: null,
              data: {},
              user: null,
            }),
          ),
        },
        campaignTrackerTask: { findMany: vi.fn(() => Promise.resolve([])) },
        organization: { findFirst: vi.fn(() => Promise.resolve(ORG)) },
      },
    } as unknown as CampaignsService
    const handler = new CampaignManagerHandler(
      store,
      campaigns,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
    )

    const ctx = await handler.loadContext('c1', 7)

    expect(ctx.electionDate).toBe('2026-11-03')
    expect(ctx.primaryElectionDate).toBe('2026-05-19')
    expect(ctx.filingPeriodStart).toBe('2025-11-05')
    expect(ctx.filingPeriodEnd).toBe('2026-01-09')
    expect(ctx.primaryResult).toBe('lost')
    expect(ctx.didWin).toBeNull()
    const prompt = handler.buildSystemPrompt(ctx)
    expect(prompt).toContain(
      'Election date on record: Tuesday, November 3, 2026',
    )
    expect(prompt).toContain('Primary result on record: lost')
  })

  it.each(['2025-Q1', 'not a date', ''])(
    'carries the unparseable date %o through and the prompt reads it as none',
    async (bad) => {
      const store = {
        findFirst: vi.fn(() =>
          Promise.resolve({ id: 'c1', organizationSlug: ORG.slug }),
        ),
      } as unknown as GeneralChatStoreService
      const campaigns = {
        client: {
          campaign: {
            findFirst: vi.fn(() =>
              Promise.resolve({
                id: 5,
                details: { electionDate: bad, filingPeriodsEnd: bad },
                data: {},
                user: null,
              }),
            ),
          },
          campaignTrackerTask: { findMany: vi.fn(() => Promise.resolve([])) },
          organization: { findFirst: vi.fn(() => Promise.resolve(ORG)) },
        },
      } as unknown as CampaignsService
      const handler = new CampaignManagerHandler(
        store,
        campaigns,
        {} as ChatStoreService,
        WIN_CONSTITUENT_TABLES,
      )

      const ctx = await handler.loadContext('c1', 7)

      expect(ctx.electionDate).toBe(bad)
      expect(ctx.filingPeriodEnd).toBe(bad)
      const prompt = handler.buildSystemPrompt(ctx)
      expect(prompt).toContain('Election date on record: none')
      expect(prompt).toContain('Filing period on record: none')
      expect(prompt).not.toContain('NaN')
    },
  )

  it('keeps web search available when the campaign does not resolve', async () => {
    const store = {
      findFirst: vi.fn(() => Promise.resolve(null)),
    } as unknown as GeneralChatStoreService
    const handler = new CampaignManagerHandler(
      store,
      {} as CampaignsService,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
    )
    const previous = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    try {
      const ctx = await handler.loadContext('missing', 1)
      expect(ctx.webSearchEnabled).toBe(true)
      expect(Object.keys(handler.buildTools(ctx))).toContain('web_search')
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = previous
    }
  })

  it('registers web_search from the context flag, not the env directly', () => {
    const handler = buildBallotHandler(ELECTIONS)
    expect(
      Object.keys(handler.buildTools(ctxWith({ webSearchEnabled: true }))),
    ).toContain('web_search')
    expect(
      Object.keys(handler.buildTools(ctxWith({ webSearchEnabled: false }))),
    ).not.toContain('web_search')
  })

  it('registers get_ballot_requirements when the race resolved', () => {
    const tools = buildBallotHandler(ELECTIONS).buildTools(
      ctxWith({ raceId: 'br-hash-1' }),
    )
    expect(Object.keys(tools)).toContain('get_ballot_requirements')
  })

  it('leaves get_ballot_requirements dark without a race hash', () => {
    const tools = buildBallotHandler(ELECTIONS).buildTools(
      ctxWith({ raceId: null }),
    )
    expect(Object.keys(tools)).not.toContain('get_ballot_requirements')
  })

  it('leaves get_ballot_requirements dark without the elections service', () => {
    const tools = buildBallotHandler(undefined).buildTools(
      ctxWith({ raceId: 'br-hash-1' }),
    )
    expect(Object.keys(tools)).not.toContain('get_ballot_requirements')
  })

  const buildLoadContextHandler = (
    organization: Organization | null,
  ): CampaignManagerHandler => {
    const store = {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'c1', organizationSlug: ORG.slug }),
      ),
    } as unknown as GeneralChatStoreService
    const campaigns = {
      client: {
        campaign: {
          findFirst: vi.fn(() =>
            Promise.resolve({
              id: 5,
              isPro: true,
              details: {},
              data: {},
              user: null,
            }),
          ),
        },
        campaignTrackerTask: { findMany: vi.fn(() => Promise.resolve([])) },
        organization: {
          findFirst: vi.fn(() => Promise.resolve(organization)),
        },
      },
    } as unknown as CampaignsService
    return new CampaignManagerHandler(
      store,
      campaigns,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
      undefined,
      undefined,
      undefined,
      buildContacts(),
      buildVoterFileFilters(),
    )
  }

  it('loadContext enables the CRM tools when contacts and an organization are present', async () => {
    const handler = buildLoadContextHandler(ORG)

    const ctx = await handler.loadContext('c1', 7)

    expect(ctx.organization).toEqual(ORG)
    expect(ctx.crmToolsEnabled).toBe(true)
    expect(ctx.savedFilterToolsEnabled).toBe(true)
    const toolNames = Object.keys(handler.buildTools(ctx))
    expect(toolNames).toContain('count_contacts')
    expect(toolNames).toContain('crud_saved_filters')
  })

  it('loadContext leaves the CRM tools off without a resolved organization', async () => {
    const handler = buildLoadContextHandler(null)

    const ctx = await handler.loadContext('c1', 7)

    expect(ctx.crmToolsEnabled).toBe(false)
    expect(ctx.savedFilterToolsEnabled).toBe(false)
    const toolNames = Object.keys(handler.buildTools(ctx))
    expect(toolNames).not.toContain('count_contacts')
    expect(toolNames).not.toContain('crud_saved_filters')
  })
})

describe('CampaignManagerHandler.loadContext — live race data', () => {
  const RECORD = {
    state: 'IL',
    electionDate: '2026-11-03',
    raceId: 'br-hash-1',
  }
  const METRICS = {
    generalElectionDate: '2026-11-03',
    primaryElectionDate: null,
    milestones: {
      voter_registration: { start: null, end: '2026-10-06' },
      early_voting: { start: '2026-10-19', end: '2026-11-02' },
      request_ballot: null,
    },
    winNumber: 1234,
    voterContactGoal: 4936,
  } as unknown as RaceTargetMetrics
  const EXPECTED = {
    status: 'ok',
    data: {
      generalElectionDate: '2026-11-03',
      primaryElectionDate: null,
      milestones: {
        voterRegistration: { start: null, end: '2026-10-06' },
        earlyVoting: { start: '2026-10-19', end: '2026-11-02' },
        ballotRequest: null,
      },
      winNumber: 1234,
      voterContactGoal: 4936,
    },
  }

  const buildLiveHandler = (
    details: Record<string, unknown>,
    fetchLiveRaceTargetMetrics: () => Promise<RaceTargetMetrics | null>,
  ) => {
    const store = {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'c1', organizationSlug: 'live-race-org' }),
      ),
    } as unknown as GeneralChatStoreService
    const fetchLive = vi.fn(fetchLiveRaceTargetMetrics)
    const campaigns = {
      fetchLiveRaceTargetMetrics: fetchLive,
      client: {
        campaign: {
          findFirst: vi.fn(() =>
            Promise.resolve({ id: 5, details, data: {}, user: null }),
          ),
        },
        campaignTrackerTask: { findMany: vi.fn(() => Promise.resolve([])) },
        organization: { findFirst: vi.fn(() => Promise.resolve(null)) },
      },
    } as unknown as CampaignsService
    const handler = new CampaignManagerHandler(
      store,
      campaigns,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
    )
    return { handler, fetchLive }
  }

  it('skips the lookup when the record has no election date', async () => {
    const { handler, fetchLive } = buildLiveHandler(
      { state: 'IL', raceId: 'br-hash-1' },
      () => Promise.resolve(METRICS),
    )
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.liveRace).toEqual({ status: 'none', reason: 'no-election-date' })
    expect(fetchLive).not.toHaveBeenCalled()
  })

  it('skips the lookup when no race is linked', async () => {
    const { handler, fetchLive } = buildLiveHandler(
      { state: 'IL', electionDate: '2026-11-03' },
      () => Promise.resolve(METRICS),
    )
    const ctx = await handler.loadContext('c1', 7)
    expect(ctx.liveRace).toEqual({ status: 'none', reason: 'no-race' })
    expect(fetchLive).not.toHaveBeenCalled()
  })

  it('maps the live metrics and renders them, cut once for the day', async () => {
    const { handler, fetchLive } = buildLiveHandler(RECORD, () =>
      Promise.resolve(METRICS),
    )
    const first = await handler.loadContext('c1', 7)
    const second = await handler.loadContext('c1', 7)
    expect(first.liveRace).toEqual(EXPECTED)
    expect(second.liveRace).toEqual(EXPECTED)
    expect(fetchLive).toHaveBeenCalledTimes(1)
    expect(handler.buildSystemPrompt(first)).toContain(
      'Current race data, fetched today:',
    )
  })

  it('cuts the data again when the local day moves on', async () => {
    vi.useFakeTimers()
    try {
      const { handler, fetchLive } = buildLiveHandler(RECORD, () =>
        Promise.resolve(METRICS),
      )
      vi.setSystemTime(new Date('2026-10-05T17:00:00.000Z'))
      await handler.loadContext('c1', 7)
      vi.setSystemTime(new Date('2026-10-05T23:00:00.000Z'))
      await handler.loadContext('c1', 7)
      expect(fetchLive).toHaveBeenCalledTimes(1)
      vi.setSystemTime(new Date('2026-10-06T17:00:00.000Z'))
      await handler.loadContext('c1', 7)
      expect(fetchLive).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads a null or failed lookup as unavailable and tries again next turn', async () => {
    let calls = 0
    const { handler, fetchLive } = buildLiveHandler(RECORD, () => {
      calls += 1
      if (calls === 1) return Promise.resolve(null)
      if (calls === 2) return Promise.reject(new Error('upstream down'))
      return Promise.resolve(METRICS)
    })
    expect((await handler.loadContext('c1', 7)).liveRace).toEqual({
      status: 'unavailable',
    })
    expect((await handler.loadContext('c1', 7)).liveRace).toEqual({
      status: 'unavailable',
    })
    expect((await handler.loadContext('c1', 7)).liveRace).toEqual(EXPECTED)
    expect(fetchLive).toHaveBeenCalledTimes(3)
  })

  it('reads a lookup that never resolves as unavailable after the timeout', async () => {
    vi.useFakeTimers()
    try {
      const { handler } = buildLiveHandler(
        RECORD,
        () => new Promise<RaceTargetMetrics | null>(() => undefined),
      )
      const loading = handler.loadContext('c1', 7)
      await vi.advanceTimersByTimeAsync(3_001)
      expect((await loading).liveRace).toEqual({ status: 'unavailable' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('binds the filing window on record into get_ballot_requirements', async () => {
    const elections = {
      fetchFilingFeeByRaceHash: vi.fn(() => Promise.resolve(null)),
    } as unknown as ElectionsService
    const handler = new CampaignManagerHandler(
      {} as GeneralChatStoreService,
      {} as CampaignsService,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      elections,
    )
    const tools = handler.buildTools(
      ctxWith({
        raceId: 'br-hash-1',
        filingPeriodStart: '2026-09-01',
        filingPeriodEnd: '2026-09-15',
      }),
    )
    const tool = tools.get_ballot_requirements as {
      execute: (input: unknown) => Promise<unknown>
    }
    expect(await tool.execute({})).toMatchObject({
      filingPeriodStart: '2026-09-01',
      filingPeriodEnd: '2026-09-15',
      noDataFound: true,
    })
  })
})

describe('CampaignManagerHandler.seedConversation', () => {
  const params = {
    scope: ChatScope.campaign_assistant,
    organizationSlug: 'org-slug',
  }

  it('seeds the first-name greeting into the new conversation', async () => {
    const appendMessage = vi.fn().mockResolvedValue(undefined)
    const findFirst = vi
      .fn()
      .mockResolvedValue({ id: 1, user: { firstName: 'Dana' } })
    const handler = new CampaignManagerHandler(
      {} as GeneralChatStoreService,
      { findFirst } as unknown as CampaignsService,
      { appendMessage } as unknown as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
    )

    await handler.seedConversation('new-1', params)

    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationSlug: 'org-slug' },
      include: { user: true },
    })
    expect(appendMessage).toHaveBeenCalledWith({
      conversationId: 'new-1',
      role: ChatMessageRole.assistant,
      content: buildCampaignManagerGreeting('Dana'),
      inputTokens: 0,
      outputTokens: 0,
    })
  })

  it('falls back to the no-name greeting when the campaign is missing', async () => {
    const appendMessage = vi.fn().mockResolvedValue(undefined)
    const handler = new CampaignManagerHandler(
      {} as GeneralChatStoreService,
      {
        findFirst: vi.fn().mockResolvedValue(null),
      } as unknown as CampaignsService,
      { appendMessage } as unknown as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
    )

    await handler.seedConversation('new-2', params)

    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: buildCampaignManagerGreeting() }),
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

describe('CampaignManagerHandler.finalizeAssistantText (backstop)', () => {
  const SMALL_COUNT_LINE = guardrailLine('small_count', 'campaign_assistant')
  const noTools = { toolEvents: [] }
  const suppressed = (rowsSuppressed: number) => ({
    toolEvents: [
      {
        toolCallId: 'call-data',
        name: 'query_constituent_data',
        args: {},
        status: 'returned' as const,
        result: { rows: [], rowsSuppressed },
      },
    ],
  })

  it('adds the legal line when the shared check fires', () => {
    const answer =
      'Under RCW 42.17A.405 that contribution is over the limit, and a ' +
      'resident can file a complaint with the state commission.'

    expect(
      buildHandler().finalizeAssistantText(answer, noTools, ctxWith({})),
    ).toBe(`\n\n${LEGAL_LINE}`)
  })

  it('does not duplicate an existing legal caution', () => {
    expect(
      buildHandler().finalizeAssistantText(
        'Under RCW 42.17A.405 that contribution is over the limit. ' +
          LEGAL_LINE,
        noTools,
        ctxWith({}),
      ),
    ).toBeNull()
  })

  it('adds the small-count line when a data result reports suppressed rows', () => {
    expect(
      buildHandler().finalizeAssistantText(
        'Voters under 30 lean toward the levy.',
        suppressed(2),
        ctxWith({}),
      ),
    ).toBe(`\n\n${SMALL_COUNT_LINE}`)
  })

  it('adds nothing when the data result suppressed no rows', () => {
    expect(
      buildHandler().finalizeAssistantText(
        'Voters under 30 lean toward the levy.',
        suppressed(0),
        ctxWith({}),
      ),
    ).toBeNull()
  })

  it('adds nothing when the model already wrote the small-count line', () => {
    expect(
      buildHandler().finalizeAssistantText(
        `Voters under 30 lean toward the levy. ${SMALL_COUNT_LINE}`,
        suppressed(2),
        ctxWith({}),
      ),
    ).toBeNull()
  })

  it('stacks the legal line before the small-count line', () => {
    expect(
      buildHandler().finalizeAssistantText(
        'Under RCW 42.17A.405 that contribution is over the limit.',
        suppressed(1),
        ctxWith({}),
      ),
    ).toBe(`\n\n${LEGAL_LINE}\n\n${SMALL_COUNT_LINE}`)
  })
})

describe('CampaignManagerHandler.finalizeAssistantText (date check)', () => {
  const logger = { setContext: vi.fn(), info: vi.fn(), error: vi.fn() }
  const withLogger = (): CampaignManagerHandler =>
    new CampaignManagerHandler(
      {} as GeneralChatStoreService,
      {} as CampaignsService,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      logger as unknown as PinoLogger,
    )
  // Monday, October 12, 2026 in Arkansas.
  const ctx = ctxWith({
    state: 'AR',
    now: new Date('2026-10-12T17:00:00.000Z'),
  })
  const turn = { toolEvents: [], conversationId: 'conv-1' }
  // Six dated posts whose weekdays are a day early, with October 15 left out.
  const shifted = [
    '**Day 1 -- Monday, October 13**',
    '**Day 2 -- Tuesday, October 14**',
    '**Day 3 -- Thursday, October 16**',
    '**Day 4 -- Friday, October 17**',
    '**Day 5 -- Saturday, October 18**',
    '**Day 6 -- Sunday, October 19**',
  ].join('\npost\n')
  const expectedLine =
    'Before you post, check these dates against the calendar: October 13 ' +
    'is a Tuesday, not a Monday; October 14 is a Wednesday, not a Tuesday; ' +
    'October 15 has no entry; October 16 is a Friday, not a Thursday; and ' +
    '3 more.'

  afterEach(() => {
    vi.unstubAllEnvs()
    logger.info.mockClear()
    logger.error.mockClear()
  })

  it('logs the findings and appends nothing while the line is off', () => {
    vi.stubEnv('CAMPAIGN_MANAGER_DATE_CHECK_LINE_ENABLED', 'false')
    expect(withLogger().finalizeAssistantText(shifted, turn, ctx)).toBeNull()
    expect(logger.info).toHaveBeenCalledWith(
      {
        conversationId: 'conv-1',
        pairs: 6,
        wrongPairCount: 6,
        wrongPairs: [
          'Monday, October 13',
          'Tuesday, October 14',
          'Thursday, October 16',
          'Friday, October 17',
          'Saturday, October 18',
          'Sunday, October 19',
        ],
        missingDays: ['2026-10-15'],
        doubledDays: [],
      },
      'campaign manager reply has dates to check',
    )
  })

  it('appends the line naming the dates when the flag is on', () => {
    vi.stubEnv('CAMPAIGN_MANAGER_DATE_CHECK_LINE_ENABLED', 'true')
    expect(withLogger().finalizeAssistantText(shifted, turn, ctx)).toBe(
      `\n\n${expectedLine}`,
    )
    expect(logger.info).toHaveBeenCalledTimes(1)
  })

  it('keeps the guardrail lines beside it', () => {
    vi.stubEnv('CAMPAIGN_MANAGER_DATE_CHECK_LINE_ENABLED', 'true')
    const legal = `Under RCW 35.21.766 you may post it.\n\n${shifted}`
    expect(withLogger().finalizeAssistantText(legal, turn, ctx)).toBe(
      `\n\n${guardrailLine('legal_advice', 'campaign_assistant')}\n\n${expectedLine}`,
    )
  })

  it('appends nothing and logs nothing for a reply whose dates are right', () => {
    vi.stubEnv('CAMPAIGN_MANAGER_DATE_CHECK_LINE_ENABLED', 'true')
    const right =
      'Early voting opens Monday, October 19 and closes Monday, November 2.'
    expect(withLogger().finalizeAssistantText(right, turn, ctx)).toBeNull()
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('logs a hit and appends nothing when the flag is unset', () => {
    vi.stubEnv('CAMPAIGN_MANAGER_DATE_CHECK_LINE_ENABLED', '')
    expect(withLogger().finalizeAssistantText(shifted, turn, ctx)).toBeNull()
    expect(logger.info).toHaveBeenCalledTimes(1)
  })

  it('logs a failure inside the check and keeps the other lines', () => {
    vi.stubEnv('CAMPAIGN_MANAGER_DATE_CHECK_LINE_ENABLED', 'true')
    const broken = ctxWith({ state: 'AR', now: new Date('not a date') })
    const legal = `Under RCW 35.21.766 you may post it.\n\n${shifted}`
    expect(withLogger().finalizeAssistantText(legal, turn, broken)).toBe(
      `\n\n${guardrailLine('legal_advice', 'campaign_assistant')}`,
    )
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('runs without a logger', () => {
    vi.stubEnv('CAMPAIGN_MANAGER_DATE_CHECK_LINE_ENABLED', 'true')
    expect(buildHandler().finalizeAssistantText(shifted, turn, ctx)).toBe(
      `\n\n${expectedLine}`,
    )
  })
})

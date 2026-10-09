import { describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../../generated/prisma'
import type { CampaignsService } from '@/campaigns/services/campaigns.service'
import type { ChatStoreService } from '@/chats/services/chatStore.prisma'
import type { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import type { FeaturesService } from '@/features/services/features.service'
import type { LlmTool } from '@/llm/services/llm.service'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { PeopleDatasetService } from '@/peopleDb/services/peopleDataset.service'
import { CampaignManagerHandler } from '../campaign-manager/campaignManager.handler'
import type { CampaignManagerContext } from '../campaign-manager/campaignManagerPrompt'
import { WIN_CONSTITUENT_TABLES } from '../campaign-manager/services/constituentDataScope'
import type { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import { ChiefOfStaffHandler } from './chiefOfStaff.handler'
import type { ChiefOfStaffBriefingsService } from './services/chiefOfStaffBriefings.service'
import type { ChiefOfStaffContextService } from './services/chiefOfStaffContext.service'
import { CONSTITUENT_TABLES_BY_DATASET } from './services/constituentDataScope'
import type { PrioritiesToolPort } from './services/prioritiesPort'

const FILTERS = [
  { column: 'state_postal_code', value: 'MI' },
  { column: 'City', value: 'Lansing' },
]
const WHERE = "WHERE state_postal_code = 'MI' AND City = 'Lansing'"

const descriptionOf = (tool: LlmTool | undefined): string => {
  if (!tool || !('description' in tool)) {
    throw new Error('expected a tool with a description')
  }
  return tool.description
}

const executeQuery = async (tool: LlmTool | undefined, sql: string) => {
  if (!tool || !('execute' in tool)) {
    throw new Error('expected an executable tool')
  }
  return tool.execute({ sql })
}

// With the local placeholder Amplitude key every flag reads ON, so the flag
// is stubbed explicitly here rather than inherited from the environment.
const peopleDatasetsWithFlag = (enabled: boolean) =>
  new PeopleDatasetService({
    isFeatureEnabled: vi.fn(() => Promise.resolve(enabled)),
  } as unknown as FeaturesService)

const buildProvider = () => ({
  query: vi.fn(() =>
    Promise.resolve({ columns: ['count'], rows: [{ count: 500 }] }),
  ),
})

const buildChiefOfStaff = (
  provider: DatabricksProvider,
  peopleDatasets: PeopleDatasetService,
) => {
  const slug = 'eo-lansing'
  const context = {
    load: vi.fn(() =>
      Promise.resolve({
        conversationId: 'c1',
        electedOfficeId: 'office-1',
        organizationSlug: slug,
        organization: { slug, ownerId: 9 } as Organization,
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
        peopleDataset: 'voters',
      }),
    ),
  } as unknown as ChiefOfStaffContextService
  const resolver = {
    resolveByOrgSlug: vi.fn(() =>
      Promise.resolve({
        state: 'MI',
        l2DistrictType: 'City',
        l2DistrictName: 'Lansing',
      }),
    ),
    toMandatoryFilters: vi.fn(() => FILTERS),
  } as unknown as DistrictResolverService
  const port = {
    listActive: vi.fn(() => Promise.resolve([])),
  } as unknown as PrioritiesToolPort
  return new ChiefOfStaffHandler(
    context,
    {
      forElectedOffice: vi.fn(() => ({})),
    } as unknown as ChiefOfStaffBriefingsService,
    port,
    CONSTITUENT_TABLES_BY_DATASET,
    provider,
    resolver,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    peopleDatasets,
  )
}

const winCtx = (): CampaignManagerContext => ({
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
  liveRace: { status: 'none', reason: 'no-race' },
  ballotStatus: null,
  filingPeriodStart: null,
  filingPeriodEnd: null,
  topTasks: [],
  districtFilters: FILTERS,
  constituentToolEnabled: true,
  organization: null,
  crmToolsEnabled: false,
  savedFilterToolsEnabled: false,
  raceId: null,
  webSearchEnabled: true,
  helpCenterToolEnabled: false,
  isPro: null,
  story: null,
  plan: null,
})

describe('constituent data table per people dataset', () => {
  it('keeps the Win Campaign Manager on win_agent_voters', async () => {
    expect(
      await peopleDatasetsWithFlag(true).resolve({
        slug: 'campaign-lansing',
        ownerId: 9,
      }),
    ).toBe('voters')

    const provider = buildProvider()
    const tools = new CampaignManagerHandler(
      {} as GeneralChatStoreService,
      {} as CampaignsService,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
      provider,
    ).buildTools(winCtx())
    const description = descriptionOf(tools.query_constituent_data)

    expect(description).toContain('FROM win_agent_voters')
    expect(description).not.toContain('not registered to vote')
    await executeQuery(
      tools.query_constituent_data,
      `SELECT COUNT(*) AS count FROM win_agent_voters ${WHERE}`,
    )
    expect(provider.query).toHaveBeenCalledWith(
      `SELECT COUNT(*) AS count FROM win_agent_voters ${WHERE}`,
    )
  })

  it('reads serve_agent_constituents for a Serve org with the flag on', async () => {
    const provider = buildProvider()
    const handler = buildChiefOfStaff(provider, peopleDatasetsWithFlag(true))
    const ctx = await handler.loadContext('c1', 7)
    const tools = handler.buildTools(ctx)

    expect(ctx.peopleDataset).toBe('constituents')
    expect(descriptionOf(tools.query_constituent_data)).toContain(
      'FROM serve_agent_constituents',
    )
    expect(descriptionOf(tools.query_constituent_data)).toContain(
      'Totals include adult residents whether or not they are registered to vote',
    )
    await expect(
      executeQuery(
        tools.query_constituent_data,
        `SELECT COUNT(*) AS count FROM serve_agent_voters ${WHERE}`,
      ),
    ).rejects.toThrow(/table not in allowlist: serve_agent_voters/)
    await executeQuery(
      tools.query_constituent_data,
      `SELECT COUNT(*) AS count FROM serve_agent_constituents ${WHERE}`,
    )
    expect(provider.query).toHaveBeenCalledWith(
      `SELECT COUNT(*) AS count FROM serve_agent_constituents ${WHERE}`,
    )
  })

  it('reads serve_agent_voters for a Serve org with the flag off', async () => {
    const handler = buildChiefOfStaff(
      buildProvider(),
      peopleDatasetsWithFlag(false),
    )
    const ctx = await handler.loadContext('c1', 7)
    const description = descriptionOf(
      handler.buildTools(ctx).query_constituent_data,
    )

    expect(ctx.peopleDataset).toBe('voters')
    expect(description).toContain('FROM serve_agent_voters')
    expect(description).not.toContain('not registered to vote')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../../generated/prisma'
import type { CampaignsService } from '@/campaigns/services/campaigns.service'
import type { ContactsService } from '@/contacts/services/contacts.service'
import type { ChatStoreService } from '@/chats/services/chatStore.prisma'
import type { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import type { FeaturesService } from '@/features/services/features.service'
import type { LlmTool } from '@/llm/services/llm.service'
import {
  DATA_SOURCE_ROUTING_RULES,
  dataSourceRoutingRules,
} from '@/llm/tools/dataSourceRouting'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import {
  type PeopleDataset,
  PeopleDatasetService,
  SERVE_CONSUMER_DATA_FLAG,
} from '@/peopleDb/services/peopleDataset.service'
import type { PositionsService } from '@/electionDb/positions/positions.service'
import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import { CampaignManagerHandler } from '../campaign-manager/campaignManager.handler'
import type { CampaignManagerContext } from '../campaign-manager/campaignManagerPrompt'
import { WIN_CONSTITUENT_TABLES } from '../campaign-manager/services/constituentDataScope'
import type { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import { ChiefOfStaffHandler } from './chiefOfStaff.handler'
import type { ChiefOfStaffBriefingsService } from './services/chiefOfStaffBriefings.service'
import type { ChiefOfStaffContextService } from './services/chiefOfStaffContext.service'
import { CONSTITUENT_TABLES_BY_DATASET } from './services/constituentDataScope'
import type { PrioritiesToolPort } from './services/prioritiesPort'
import type { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'

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
const peopleDatasetsWithFlag = (enabled: boolean, importContacts = false) =>
  new PeopleDatasetService(
    {
      isFeatureEnabled: vi.fn(({ feature }: { feature: string }) =>
        Promise.resolve(
          feature === SERVE_CONSUMER_DATA_FLAG
            ? enabled
            : feature === SERVE_IMPORT_CONTACTS_FLAG && importContacts,
        ),
      ),
    } as unknown as FeaturesService,
    {} as PositionsService,
  )

const buildProvider = () => ({
  query: vi.fn(() =>
    Promise.resolve({ columns: ['count'], rows: [{ count: 500 }] }),
  ),
})

const buildChiefOfStaff = (
  provider: DatabricksProvider,
  peopleDatasets: PeopleDatasetService,
  resolvedDistrict: { state: string } | null = {
    state: 'MI',
  },
) => {
  const slug = 'eo-lansing'
  const context = {
    load: vi.fn(() =>
      Promise.resolve({
        conversationId: 'c1',
        electedOfficeId: 'office-1',
        organizationSlug: slug,
        organization: {
          slug,
          ownerId: 9,
          overrideDistrictId: 'district-1',
          positionId: null,
        } as Organization,
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
        peopleDataset: { base: 'voters' },
      }),
    ),
  } as unknown as ChiefOfStaffContextService
  const resolver = {
    resolveByOrgSlug: vi.fn(() =>
      Promise.resolve(
        resolvedDistrict && {
          ...resolvedDistrict,
          l2DistrictType: 'City',
          l2DistrictName: 'Lansing',
        },
      ),
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
    {
      getFilterDimensions: vi.fn(() => []),
    } as unknown as ContactsService,
    {} as VoterFileFilterService,
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
  smsCompliance: null,
  smsCutoffDate: null,
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
  publicProfile: { status: 'not-live' },
})

describe('constituent data table per people dataset', () => {
  it('keeps the Win Campaign Manager on win_agent_voters', async () => {
    expect(
      await peopleDatasetsWithFlag(true).resolve({
        slug: 'campaign-lansing',
        ownerId: 9,
        overrideDistrictId: null,
        positionId: null,
      }),
    ).toEqual({ base: 'voters' })

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

    expect(ctx.peopleDataset).toEqual({ base: 'constituents' })
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

  it('joins the org imported contacts when serve-import-contacts is on', async () => {
    const provider = buildProvider()
    const handler = buildChiefOfStaff(
      provider,
      peopleDatasetsWithFlag(true, true),
    )
    const ctx = await handler.loadContext('c1', 7)
    const sql =
      'SELECT on_uploaded_list, COUNT(*) AS count' +
      ` FROM serve_agent_constituents ${WHERE} GROUP BY on_uploaded_list`

    expect(ctx.peopleDataset).toEqual({
      base: 'constituents',
      overlayOrgSlug: 'eo-lansing',
      overlayDistrictId: 'district-1',
    })
    await executeQuery(handler.buildTools(ctx).query_constituent_data, sql)
    expect(provider.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /^SELECT on_uploaded_list, COUNT\(\*\) AS count FROM \(SELECT b\.\* EXCEPT .+ FULL OUTER JOIN .+\) AS serve_agent_constituents WHERE /,
      ),
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

    expect(ctx.peopleDataset).toEqual({ base: 'voters' })
    expect(description).toContain('FROM serve_agent_voters')
    expect(description).not.toContain('not registered to vote')
  })

  it('gives the CRM tools the routing rules for the turn dataset', async () => {
    const handler = buildChiefOfStaff(
      buildProvider(),
      peopleDatasetsWithFlag(true),
    )
    const tools = handler.buildTools(await handler.loadContext('c1', 7))

    for (const name of [
      'describe_filter_dimensions',
      'count_contacts',
      'crud_saved_filters',
    ]) {
      expect(descriptionOf(tools[name])).toContain(
        dataSourceRoutingRules({ base: 'constituents' }),
      )
      expect(descriptionOf(tools[name])).not.toContain(
        DATA_SOURCE_ROUTING_RULES,
      )
    }
  })

  it('keeps the CRM tools on the voters routing rules with the flag off', async () => {
    const handler = buildChiefOfStaff(
      buildProvider(),
      peopleDatasetsWithFlag(false),
    )
    const tools = handler.buildTools(await handler.loadContext('c1', 7))

    for (const name of [
      'describe_filter_dimensions',
      'count_contacts',
      'crud_saved_filters',
    ]) {
      expect(descriptionOf(tools[name])).toContain(DATA_SOURCE_ROUTING_RULES)
    }
  })

  it('resolves the dataset for the CRM tools when the district does not', async () => {
    const handler = buildChiefOfStaff(
      buildProvider(),
      peopleDatasetsWithFlag(true),
      null,
    )
    const ctx = await handler.loadContext('c1', 7)

    expect(ctx.peopleDataset).toEqual({ base: 'constituents' })
    expect(handler.buildTools(ctx).query_constituent_data).toBeUndefined()
    expect(descriptionOf(handler.buildTools(ctx).count_contacts)).toContain(
      dataSourceRoutingRules({ base: 'constituents' }),
    )
  })
})

describe('Win Campaign Manager imported-contact overlay', () => {
  const SLUG = 'campaign-lansing'
  const OVERLAY_DATASET: PeopleDataset = {
    base: 'voters',
    overlayOrgSlug: SLUG,
    overlayDistrictId: 'district-1',
  }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // The other services stay unset; the dataset is stubbed at the field the
  // handler reads, so this holds whichever orgs PeopleDatasetService gives
  // the overlay.
  const buildCampaignManager = (
    provider: DatabricksProvider,
    dataset: PeopleDataset,
  ) => {
    const organization = {
      slug: SLUG,
      ownerId: 9,
      overrideDistrictId: 'district-1',
      positionId: null,
    } as Organization
    const peopleDatasets = {
      resolve: vi.fn(() => Promise.resolve(dataset)),
    } as unknown as PeopleDatasetService
    const handler = new CampaignManagerHandler(
      {
        findFirst: vi.fn(() =>
          Promise.resolve({ id: 'c1', organizationSlug: SLUG }),
        ),
      } as unknown as GeneralChatStoreService,
      {
        client: {
          campaign: {
            findFirst: vi.fn(() =>
              Promise.resolve({ id: 5, details: {}, data: {}, user: null }),
            ),
          },
          campaignTrackerTask: { findMany: vi.fn(() => Promise.resolve([])) },
          organization: {
            findFirst: vi.fn(() => Promise.resolve(organization)),
          },
        },
      } as unknown as CampaignsService,
      {} as ChatStoreService,
      WIN_CONSTITUENT_TABLES,
      provider,
      {
        resolveByOrgSlug: vi.fn(() =>
          Promise.resolve({
            state: 'MI',
            l2DistrictType: 'City',
            l2DistrictName: 'Lansing',
          }),
        ),
        toMandatoryFilters: vi.fn(() => FILTERS),
      } as unknown as DistrictResolverService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      peopleDatasets,
    )
    return { handler, peopleDatasets, organization }
  }

  it('swaps the Win overlay join in after validation when the dataset carries it', async () => {
    vi.stubEnv(
      'WIN_AGENT_CONTACT_OVERLAY_VIEW',
      'win_agent_contact_overlay_dev',
    )
    const provider = buildProvider()
    const { handler, peopleDatasets, organization } = buildCampaignManager(
      provider,
      OVERLAY_DATASET,
    )
    const ctx = await handler.loadContext('c1', 7)
    const sql =
      'SELECT on_uploaded_list, COUNT(*) AS count' +
      ` FROM win_agent_voters ${WHERE} GROUP BY on_uploaded_list`

    expect(peopleDatasets.resolve).toHaveBeenCalledWith(organization)
    expect(ctx.peopleDataset).toEqual(OVERLAY_DATASET)
    await executeQuery(handler.buildTools(ctx).query_constituent_data, sql)
    expect(provider.query).toHaveBeenCalledWith(
      'SELECT on_uploaded_list, COUNT(*) AS count FROM (SELECT b.* EXCEPT' +
        ' (`voter_key`, `state_postal_code`, `City`),' +
        ' coalesce(b.`voter_key`, o.`voter_key`) AS `voter_key`,' +
        " 'MI' AS `state_postal_code`, 'Lansing' AS `City`," +
        ' coalesce(o.`on_uploaded_list`, false) AS `on_uploaded_list`,' +
        ' coalesce(o.`has_email`, false) AS `has_email`' +
        ' FROM (SELECT * FROM' +
        ' goodparty_data_catalog.mart_win_agents.win_agent_voters' +
        " WHERE `state_postal_code` = 'MI' AND `City` = 'Lansing') b" +
        ' FULL OUTER JOIN (SELECT * FROM' +
        ' goodparty_data_catalog.mart_win_agents.win_agent_contact_overlay_dev' +
        ` WHERE organization_slug = '${SLUG}') o` +
        ' ON o.`voter_key` = b.`voter_key`) AS win_agent_voters' +
        ` ${WHERE} GROUP BY on_uploaded_list`,
    )
  })

  it('rejects a query the validator refuses before any overlay read', async () => {
    const provider = buildProvider()
    const { handler } = buildCampaignManager(provider, OVERLAY_DATASET)
    const tools = handler.buildTools(await handler.loadContext('c1', 7))

    await expect(
      executeQuery(
        tools.query_constituent_data,
        'SELECT has_email, COUNT(*) AS count FROM win_agent_voters' +
          " WHERE state_postal_code = 'MI' GROUP BY has_email",
      ),
    ).rejects.toThrow()
    await expect(
      executeQuery(
        tools.query_constituent_data,
        `SELECT COUNT(*) AS count FROM win_agent_contact_overlay ${WHERE}`,
      ),
    ).rejects.toThrow(/table not in allowlist/)
    expect(provider.query).not.toHaveBeenCalled()
  })

  it('keeps the floor on overlay results', async () => {
    const provider = {
      query: vi.fn(() =>
        Promise.resolve({
          columns: ['on_uploaded_list', 'count'],
          rows: [
            { on_uploaded_list: false, count: 5000 },
            { on_uploaded_list: true, count: 29 },
          ],
        }),
      ),
    }
    const { handler } = buildCampaignManager(provider, OVERLAY_DATASET)
    const result = await executeQuery(
      handler.buildTools(await handler.loadContext('c1', 7))
        .query_constituent_data,
      'SELECT on_uploaded_list, COUNT(*) AS count' +
        ` FROM win_agent_voters ${WHERE} GROUP BY on_uploaded_list`,
    )

    expect(result).toMatchObject({
      rows: [{ on_uploaded_list: false, count: 5000 }],
      rowsSuppressed: 1,
    })
  })

  it('names the uploaded-list dimensions in the routing rules only with the overlay', async () => {
    const withOverlay = buildCampaignManager(buildProvider(), OVERLAY_DATASET)
    const without = buildCampaignManager(buildProvider(), { base: 'voters' })

    expect(
      descriptionOf(
        withOverlay.handler.buildTools(
          await withOverlay.handler.loadContext('c1', 7),
        ).query_constituent_data,
      ),
    ).toContain(dataSourceRoutingRules(OVERLAY_DATASET))
    expect(
      descriptionOf(
        without.handler.buildTools(await without.handler.loadContext('c1', 7))
          .query_constituent_data,
      ),
    ).toContain(DATA_SOURCE_ROUTING_RULES)
  })

  it('reads the bare table and refuses overlay columns without the overlay', async () => {
    const provider = buildProvider()
    const { handler } = buildCampaignManager(provider, { base: 'voters' })
    const tools = handler.buildTools(await handler.loadContext('c1', 7))

    await expect(
      executeQuery(
        tools.query_constituent_data,
        'SELECT on_uploaded_list, COUNT(*) AS count' +
          ` FROM win_agent_voters ${WHERE} GROUP BY on_uploaded_list`,
      ),
    ).rejects.toThrow(/on_uploaded_list/)
    await executeQuery(
      tools.query_constituent_data,
      `SELECT COUNT(*) AS count FROM win_agent_voters ${WHERE}`,
    )
    expect(provider.query).toHaveBeenCalledWith(
      `SELECT COUNT(*) AS count FROM win_agent_voters ${WHERE}`,
    )
  })
})

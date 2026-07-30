import { Test } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseISO } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import {
  RECOMMENDED_LIST_OUTREACH_TYPE_VALUES,
  RecommendedListEnvelope,
} from '@goodparty_org/contracts'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { WIN_AGENT_VOTER_DIMENSIONS } from '@/chats/general/campaign-manager/services/constituentDimensions.winAgentVoters'
import { RECOMMENDED_LISTS_DATABRICKS } from '../recommendedLists.constants'
import { RecommendedListsComputeService } from './recommendedListsCompute.service'
import {
  electionCode,
  exponentA,
  officeR,
  partisanUnionPredicate,
  pickSubGeo,
} from './recommendedListsRules.util'
import {
  anchorTurfs,
  districtFilter,
  gotvDropoff,
  issueUniverse,
  partisanAggregate,
  partisanTurfs,
  subGeoStats,
  votescoreHistogram,
} from './recommendedListsQueries'
import { RECOMMENDED_LISTS_REGISTRY } from './recommendedListsRegistry'

type Row = Record<string, unknown>

const ALL_OUTREACH_TYPES = [...RECOMMENDED_LIST_OUTREACH_TYPE_VALUES]

const CAMPAIGN_ID = 42
const RACE_ID = 'race-1'
const ORG_SLUG = 'scott-commish'
const STATE = 'MN'
const DTYPE = 'County_Commissioner_District'
const DNAME = 'SCOTT CNTY COMM DIST 5'
const HS_COL = 'hs_trump_vs_harris_double_dislike'
const SUB_COLS = ['County', 'City', 'Precinct'] as const

const allowedHs = new Set(
  WIN_AGENT_VOTER_DIMENSIONS.filter((col) => col.startsWith('hs_')),
)
const DF = districtFilter(
  STATE,
  DTYPE,
  DNAME,
  new Set(WIN_AGENT_VOTER_DIMENSIONS),
)

const HISTOGRAM: Row[] = [
  { s: 5, n: 30 },
  { s: 4, n: 25 },
  { s: 3, n: 20 },
  { s: 2, n: 15 },
  { s: 1, n: 10 },
  { s: 0, n: 5 },
]
const SUB_GEO_ROW: Row = {
  County_distinct: 5,
  County_coverage: 0.9,
  City_distinct: 8,
  City_coverage: 0.95,
  Precinct_distinct: 40,
  Precinct_coverage: 0.99,
}
const ANCHOR_TURFS: Row[] = [
  { area: 'SHAKOPEE', n: 60 },
  { area: 'PRIOR LAKE', n: 40 },
]
const ISSUE_ROW: Row = {
  active: 200,
  supporters: 80,
  opponents: 30,
  persuadable: 90,
  supportersPlausible: 50,
}
const AGGREGATE_P4: Row = {
  tot: 41230,
  list1: 18500,
  uni: 8200,
  listn: 5600,
  switch: 900,
  ticket: 1200,
  priblt: 700,
  dislike: 1500,
  modeledI: 3400,
  reg: 2100,
}
const PARTISAN_TURFS: Row[] = [{ area: 'SAVAGE', n: 2100 }]
const GOTV_ROW: Row = { X: 4200 }

const subFor = (districtType: string): 'County' | 'City' | 'Precinct' =>
  pickSubGeo(
    SUB_COLS.map((col) => ({
      col,
      distinct: Number(SUB_GEO_ROW[`${col}_distinct`]),
      coverage: Number(SUB_GEO_ROW[`${col}_coverage`]),
    })),
    districtType,
  )

const strategyContext = (overrides: Record<string, unknown> = {}) => ({
  projected_turnout: 100,
  registered_voters: 41230,
  win_number_effective: 9201,
  office_level: 'COUNTY',
  official_office_name: 'County Commissioner District 5',
  relevant_election_date: '2026-11-03',
  general_election_date: '2026-11-03',
  partisan_type: 'partisan',
  state: STATE,
  candidates: [
    { full_name: 'John Smith', party: 'Independent' },
    { full_name: 'Jane Doe', party: 'Democratic' },
  ],
  ...overrides,
})

const standoutRow = (overrides: Record<string, unknown> = {}) => ({
  hsColumn: HS_COL,
  positionDir: 'high',
  positionPhrase: 'Protecting local water quality',
  issue: 'Water',
  opponentName: 'Jane Doe',
  order: 0,
  ...overrides,
})

const summaryRow = () => ({
  sections: {
    opponentName: 'Jane Doe',
    overview: null,
    background: null,
    generatedAt: null,
    threatTier: 'primary_threat',
  },
})

interface SetupOptions {
  snapshot?: Row | null
  context?: Record<string, unknown> | null
  standoutRows?: Row[]
  summaryRows?: Row[]
  routes?: Map<string, Row[]>
  databricksError?: Error
}

const makeDatabricks = (routes: Map<string, Row[]>, error?: Error) => ({
  query: vi.fn(async (sql: string) => {
    if (error) throw error
    const rows = routes.get(sql)
    if (!rows) {
      throw new Error(`Unregistered SQL (query drift?):\n${sql}`)
    }
    return { columns: [], rows }
  }),
})

const setup = async (options: SetupOptions = {}) => {
  const snapshot =
    options.snapshot === undefined
      ? { campaignId: CAMPAIGN_ID, status: 'pending', raceId: RACE_ID }
      : options.snapshot
  const update = vi.fn().mockResolvedValue({})
  const prisma = {
    recommendedListsSnapshot: {
      findUnique: vi.fn().mockResolvedValue(snapshot),
      update,
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
    },
    campaign: {
      findUnique: vi.fn().mockResolvedValue({
        id: CAMPAIGN_ID,
        organizationSlug: ORG_SLUG,
        user: { firstName: 'John', lastName: 'Smith' },
      }),
    },
    raceOpponentStandoutAction: {
      findMany: vi.fn().mockResolvedValue(options.standoutRows ?? []),
    },
    raceOpponentSummary: {
      findMany: vi.fn().mockResolvedValue(options.summaryRows ?? []),
    },
  }
  const context =
    options.context === undefined ? strategyContext() : options.context
  const elections = {
    fetchCampaignStrategyContext: vi.fn().mockResolvedValue(context),
  }
  const districtResolver = {
    resolveByOrgSlug: vi.fn().mockResolvedValue({
      state: STATE,
      l2DistrictType: DTYPE,
      l2DistrictName: DNAME,
    }),
  }
  const databricks = makeDatabricks(
    options.routes ?? new Map(),
    options.databricksError,
  )

  const moduleRef = await Test.createTestingModule({
    providers: [
      RecommendedListsComputeService,
      { provide: PrismaService, useValue: prisma },
      { provide: PinoLogger, useValue: createMockLogger() },
      { provide: DistrictResolverService, useValue: districtResolver },
      { provide: ElectionsService, useValue: elections },
      { provide: RECOMMENDED_LISTS_DATABRICKS, useValue: databricks },
    ],
  }).compile()

  const service = moduleRef.get(RecommendedListsComputeService)
  return { service, update, prisma, databricks, elections, districtResolver }
}

// Registers the exact SQL each builder emits for the given inputs, so the fake
// throws (and the test fails) if the compute service's query drifts from the
// builders.
const routesFor = (opts: {
  sstar: number | null
  hasDem: boolean
  hasGop: boolean
  isPartisan: boolean
  officeLevel: string
  dir?: 'high' | 'low'
}): Map<string, Row[]> => {
  const sub = subFor(DTYPE)
  const routes = new Map<string, Row[]>()
  routes.set(votescoreHistogram(DF), HISTOGRAM)
  routes.set(subGeoStats(DF, SUB_COLS), [SUB_GEO_ROW])
  if (opts.sstar !== null) {
    routes.set(anchorTurfs(DF, sub, opts.sstar), ANCHOR_TURFS)
  }
  routes.set(
    issueUniverse(DF, HS_COL, opts.dir ?? 'high', opts.sstar, allowedHs),
    [ISSUE_ROW],
  )
  routes.set(partisanAggregate(DF, opts.hasDem, opts.hasGop, opts.sstar), [
    AGGREGATE_P4,
  ])
  routes.set(
    partisanTurfs(
      DF,
      sub,
      opts.sstar,
      partisanUnionPredicate(opts.hasDem, opts.hasGop),
    ),
    PARTISAN_TURFS,
  )
  const a = exponentA(officeR(opts.officeLevel, DTYPE, opts.isPartisan))
  if (a !== null) routes.set(gotvDropoff(DF, a), [GOTV_ROW])
  return routes
}

const payloadOf = (update: ReturnType<typeof vi.fn>) => {
  const call = update.mock.calls[0]
  if (!call) throw new Error('snapshot update was never called')
  return call[0].data
}

describe('RecommendedListsComputeService.handleRecompute', () => {
  beforeEach(() => vi.clearAllMocks())

  it('assembles the full ready payload from context + Databricks rowsets', async () => {
    const routes = routesFor({
      sstar: 1,
      hasDem: true,
      hasGop: false,
      isPartisan: true,
      officeLevel: 'COUNTY',
    })
    const { service, update } = await setup({
      routes,
      standoutRows: [standoutRow()],
      summaryRows: [summaryRow()],
    })

    const result = await service.handleRecompute({
      campaignId: CAMPAIGN_ID,
      raceId: RACE_ID,
      attempt: 1,
    })

    expect(result).toBe(true)
    const data = payloadOf(update)
    expect(data.status).toBe('ready')
    expect(data.error).toBeNull()
    expect(data.computedAt).toBeInstanceOf(Date)

    const a = exponentA(officeR('COUNTY', DTYPE, true))
    expect(data.payload).toEqual({
      meta: {
        officeName: 'County Commissioner District 5',
        state: 'MN',
        districtType: DTYPE,
        districtName: DNAME,
        districtLabel: 'SCOTT CNTY COMM DIST 5, MN',
        registeredVoters: 41230,
        projectedTurnout: 100,
        votesNeeded: 9201,
        electionCode: electionCode(parseISO('2026-11-03'), STATE),
        electionDate: '2026-11-03',
        subGeoLabel: 'counties',
        doorRatio: 0.62,
      },
      lists: [
        {
          variant: 'voterSupportId',
          goal: 'introduction',
          name: 'Candidate Intro & Voter Support ID',
          priority: 1,
          allowedOutreachTypes: ALL_OUTREACH_TYPES,
          allowedPhases: ['earlyCampaign', 'midCampaign', 'gotvPhase'],
          details: {
            votescoreThreshold: 1,
            voterCount: 100,
            doorCount: 62,
            estimatedHours: 62 / 15,
            turfs: [
              { area: 'SHAKOPEE', voterCount: 60 },
              { area: 'PRIOR LAKE', voterCount: 40 },
            ],
          },
        },
        {
          variant: 'persuasionPartisanAligned',
          goal: 'persuasion',
          name: 'Voters open to an independent choice',
          priority: 2,
          allowedOutreachTypes: ALL_OUTREACH_TYPES,
          allowedPhases: ['midCampaign'],
          details: {
            shape: 'P4',
            isPartisanRace: true,
            hasDemOpponent: true,
            hasGopOpponent: false,
            targetParties: 'Republicans and Independents',
            cardSubtitle: expect.stringContaining(
              'Independents or Republicans',
            ),
            signals: {
              partySwitchers: 900,
              ticketSplitters: 1200,
              crossoverPrimary: 700,
              doubleDislike: 1500,
              modeledIndependents: 3400,
              registrationAddOn: 2100,
            },
            districtTotal: 41230,
            districtWideUnionCount: 8200,
            plausibleElectorateCount: 18500,
            listCount: 5600,
            turfs: [{ area: 'SAVAGE', voterCount: 2100 }],
          },
        },
        {
          variant: 'persuasionIssueAligned',
          goal: 'persuasion',
          name: 'Voters who lean toward Protecting local water quality',
          priority: 3,
          allowedOutreachTypes: ALL_OUTREACH_TYPES,
          allowedPhases: ['midCampaign'],
          details: {
            phrase: 'Protecting local water quality',
            opponentName: 'Jane Doe',
            threatTier: 'primary_threat',
            activeVoters: 200,
            supporters: 80,
            opponents: 30,
            persuadable: 90,
            supportersPlausible: 50,
          },
        },
        {
          variant: 'gotv',
          goal: 'gotv',
          name: 'Get Out The Vote',
          priority: 3,
          allowedOutreachTypes: ALL_OUTREACH_TYPES,
          allowedPhases: ['gotvPhase'],
          details: {
            dropoffX: 4200,
            exponentA: Math.round((a ?? 0) * 100) / 100,
          },
        },
      ],
    })

    const envelopes = data.payload.lists as RecommendedListEnvelope[]
    for (const envelope of envelopes) {
      expect(envelope.goal).toBe(
        RECOMMENDED_LISTS_REGISTRY[envelope.variant].goal,
      )
    }
  })

  it('drops an issue card whose active cell count is below the floor', async () => {
    const routes = routesFor({
      sstar: 1,
      hasDem: true,
      hasGop: false,
      isPartisan: true,
      officeLevel: 'COUNTY',
    })
    routes.set(issueUniverse(DF, HS_COL, 'high', 1, allowedHs), [
      { ...ISSUE_ROW, active: 49 },
    ])
    const { service, update } = await setup({
      routes,
      standoutRows: [standoutRow()],
      summaryRows: [summaryRow()],
    })

    await service.handleRecompute({
      campaignId: CAMPAIGN_ID,
      raceId: RACE_ID,
      attempt: 1,
    })

    const variants = payloadOf(update).payload.lists.map(
      (envelope: { variant: string }) => envelope.variant,
    )
    expect(variants).not.toContain('persuasionIssueAligned')
  })

  it('produces an NP1 card with null add-ons when no major-party opponent runs', async () => {
    const routes = routesFor({
      sstar: 1,
      hasDem: false,
      hasGop: false,
      isPartisan: false,
      officeLevel: 'CITY',
    })
    const npAggregate = { ...AGGREGATE_P4 }
    delete npAggregate.reg
    routes.set(partisanAggregate(DF, false, false, 1), [npAggregate])
    const { service, update } = await setup({
      routes,
      context: strategyContext({
        partisan_type: 'nonpartisan',
        office_level: 'CITY',
        candidates: [
          { full_name: 'John Smith', party: 'Independent' },
          { full_name: 'Jane Doe', party: 'Independent' },
        ],
      }),
    })

    await service.handleRecompute({
      campaignId: CAMPAIGN_ID,
      raceId: RACE_ID,
      attempt: 1,
    })

    const envelope = payloadOf(update).payload.lists.find(
      (list: { variant: string }) =>
        list.variant === 'persuasionPartisanAligned',
    )
    const partisan = envelope.details
    expect(partisan.shape).toBe('NP1')
    expect(partisan.isPartisanRace).toBe(false)
    expect(partisan.targetParties).toBeNull()
    expect(partisan.signals.registrationAddOn).toBeNull()
  })

  it('degrades the anchor to nulls when projected turnout is missing', async () => {
    const routes = routesFor({
      sstar: null,
      hasDem: true,
      hasGop: false,
      isPartisan: true,
      officeLevel: 'COUNTY',
    })
    const { service, update } = await setup({
      routes,
      context: strategyContext({ projected_turnout: null }),
      standoutRows: [standoutRow()],
      summaryRows: [summaryRow()],
    })

    const result = await service.handleRecompute({
      campaignId: CAMPAIGN_ID,
      raceId: RACE_ID,
      attempt: 1,
    })

    expect(result).toBe(true)
    const data = payloadOf(update)
    expect(data.status).toBe('ready')
    const anchor = data.payload.lists.find(
      (list: { variant: string }) => list.variant === 'voterSupportId',
    )
    expect(anchor.details).toEqual({
      votescoreThreshold: null,
      voterCount: null,
      doorCount: null,
      estimatedHours: null,
      turfs: [],
    })
    expect(data.payload.meta.projectedTurnout).toBeNull()
  })

  it('ack-drops a recompute for a snapshot that is no longer pending', async () => {
    const { service, update, databricks } = await setup({
      snapshot: { campaignId: CAMPAIGN_ID, status: 'ready', raceId: RACE_ID },
    })

    const result = await service.handleRecompute({
      campaignId: CAMPAIGN_ID,
      raceId: RACE_ID,
      attempt: 1,
    })

    expect(result).toBe(true)
    expect(update).not.toHaveBeenCalled()
    expect(databricks.query).not.toHaveBeenCalled()
  })

  it('ack-drops a recompute whose raceId no longer matches the snapshot', async () => {
    const { service, update } = await setup({
      snapshot: {
        campaignId: CAMPAIGN_ID,
        status: 'pending',
        raceId: 'race-2',
      },
    })

    const result = await service.handleRecompute({
      campaignId: CAMPAIGN_ID,
      raceId: RACE_ID,
      attempt: 1,
    })

    expect(result).toBe(true)
    expect(update).not.toHaveBeenCalled()
  })

  it('marks the snapshot failed without throwing when a query errors', async () => {
    const { service, update } = await setup({
      databricksError: new Error('databricks unavailable'),
    })

    const result = await service.handleRecompute({
      campaignId: CAMPAIGN_ID,
      raceId: RACE_ID,
      attempt: 1,
    })

    expect(result).toBe(true)
    const data = payloadOf(update)
    expect(data.status).toBe('failed')
    expect(data.error).toContain('databricks unavailable')
  })
})

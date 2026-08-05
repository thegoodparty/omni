import { Test } from '@nestjs/testing'
import { describe, expect, it, vi } from 'vitest'
import { PinoLogger } from 'nestjs-pino'
import { RecommendedListsSchema } from '@goodparty_org/contracts'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { WIN_AGENT_VOTER_DIMENSIONS } from '@/chats/general/campaign-manager/services/constituentDimensions.winAgentVoters'
import { RECOMMENDED_LISTS_DATABRICKS } from '../recommendedLists.constants'
import { RecommendedListsComputeService } from './recommendedListsCompute.service'
import {
  exponentA,
  officeR,
  partisanUnionPredicate,
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

// The false direction of the isActive gate can't be exercised against the real
// registry (every entry ships active), so serve the real module with only the
// gotv entry flipped off.
vi.mock('./recommendedListsRegistry', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./recommendedListsRegistry')>()
  return {
    ...actual,
    RECOMMENDED_LISTS_REGISTRY: {
      ...actual.RECOMMENDED_LISTS_REGISTRY,
      gotv: { ...actual.RECOMMENDED_LISTS_REGISTRY.gotv, isActive: false },
    },
  }
})

type Row = Record<string, unknown>

const CAMPAIGN_ID = 42
const RACE_ID = 'race-1'
const STATE = 'MN'
const DTYPE = 'County_Commissioner_District'
const DNAME = 'SCOTT CNTY COMM DIST 5'
const HS_COL = 'hs_trump_vs_harris_double_dislike'
const SSTAR = 1
const SUB = 'County'
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
const ISSUE_ROW: Row = {
  active: 200,
  supporters: 80,
  opponents: 30,
  persuadable: 90,
  supportersPlausible: 50,
}
const AGGREGATE: Row = {
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

describe('RecommendedListsComputeService isActive gate', () => {
  it('skips a registry-deactivated variant while emitting the rest', async () => {
    const a = exponentA(officeR('COUNTY', DTYPE, true))
    if (a === null) throw new Error('fixture expects a gotv-eligible office')
    const routes = new Map<string, Row[]>([
      [votescoreHistogram(DF), HISTOGRAM],
      [subGeoStats(DF, SUB_COLS), [SUB_GEO_ROW]],
      [anchorTurfs(DF, SUB, SSTAR), [{ area: 'SHAKOPEE', n: 60 }]],
      [issueUniverse(DF, HS_COL, 'high', SSTAR, allowedHs), [ISSUE_ROW]],
      [partisanAggregate(DF, true, false, SSTAR), [AGGREGATE]],
      [
        partisanTurfs(DF, SUB, SSTAR, partisanUnionPredicate(true, false)),
        [{ area: 'SAVAGE', n: 2100 }],
      ],
      [gotvDropoff(DF, a), [{ X: 4200 }]],
    ])
    const update = vi.fn().mockResolvedValue({})
    const prisma = {
      recommendedListsSnapshot: {
        findUnique: vi.fn().mockResolvedValue({
          campaignId: CAMPAIGN_ID,
          status: 'pending',
          raceId: RACE_ID,
        }),
        update,
      },
      campaign: {
        findUnique: vi.fn().mockResolvedValue({
          id: CAMPAIGN_ID,
          organizationSlug: 'scott-commish',
          user: { firstName: 'John', lastName: 'Smith' },
        }),
      },
      raceOpponentStandoutAction: {
        findMany: vi.fn().mockResolvedValue([
          {
            hsColumn: HS_COL,
            positionDir: 'high',
            positionPhrase: 'Protecting local water quality',
            issue: 'Water',
            opponentName: 'Jane Doe',
            order: 0,
          },
        ]),
      },
      raceOpponentSummary: { findMany: vi.fn().mockResolvedValue([]) },
    }
    const databricks = {
      query: vi.fn(async (sql: string) => {
        const rows = routes.get(sql)
        if (!rows) {
          throw new Error(`Unregistered SQL (query drift?):\n${sql}`)
        }
        return { columns: [], rows }
      }),
    }
    const moduleRef = await Test.createTestingModule({
      providers: [
        RecommendedListsComputeService,
        { provide: PrismaService, useValue: prisma },
        { provide: PinoLogger, useValue: createMockLogger() },
        {
          provide: DistrictResolverService,
          useValue: {
            resolveByOrgSlug: vi.fn().mockResolvedValue({
              state: STATE,
              l2DistrictType: DTYPE,
              l2DistrictName: DNAME,
            }),
          },
        },
        {
          provide: ElectionsService,
          useValue: {
            fetchCampaignStrategyContext: vi.fn().mockResolvedValue({
              // Anchor sizes to 3 x win_number_effective (the vote goal); 3 x 33 =
              // 99 lands in the VOTESCORE >= 1 band of HISTOGRAM, keeping SSTAR = 1.
              projected_turnout: 65,
              registered_voters: 41230,
              win_number_effective: 33,
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
            }),
          },
        },
        { provide: RECOMMENDED_LISTS_DATABRICKS, useValue: databricks },
      ],
    }).compile()
    const service = moduleRef.get(RecommendedListsComputeService)

    const result = await service.handleRecompute({
      campaignId: CAMPAIGN_ID,
      raceId: RACE_ID,
      attempt: 1,
    })

    expect(result).toBe(true)
    const call = update.mock.calls[0]
    if (!call) throw new Error('snapshot update was never called')
    const data = call[0].data
    expect(data.status).toBe('ready')
    const lists = RecommendedListsSchema.parse(data.payload).lists
    expect(lists.map((envelope) => envelope.variant)).toEqual([
      'voterSupportId',
      'persuasionPartisanAligned',
      'persuasionIssueAligned',
    ])
  })
})

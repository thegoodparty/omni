import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { HubspotService } from '@/crm/hubspot.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { HubSpot } from '@/crm/crm.types'
import { formatDateForCRM } from '@/crm/util/cms.util'
import { Campaign } from '@/generated/prisma'
import { CampaignCreatedBy } from '@goodparty_org/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CrmCampaignsService } from './crmCampaigns.service'
import { CampaignsService } from './campaigns.service'
import { UsersService } from '../../users/services/users.service'
import { OrganizationsService } from '../../organizations/services/organizations.service'
import { AiChatService } from '../ai/chat/aiChat.service'
import { VoterFileDownloadAccessService } from '../../shared/services/voterFileDownloadAccess.service'
import { EcanvasserIntegrationService } from '../../vendors/ecanvasserIntegration/services/ecanvasserIntegration.service'

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

const measure = async (fn: () => Promise<void>) => {
  const start = performance.now()
  await fn()
  return performance.now() - start
}

type Latency = {
  user: number
  aiChat: number
  liveMetrics: number
  org: number
  tcr: number
  ecanvasser: number
}

const noLatency: Latency = {
  user: 0,
  aiChat: 0,
  liveMetrics: 0,
  org: 0,
  tcr: 0,
  ecanvasser: 0,
}

const user = {
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  metaData: { lastVisited: '2024-01-20', sessionCount: 12 },
}

const orgContext = {
  district: { id: 'district-1', state: 'CA', l2Type: 'City', l2Name: 'Poway' },
  ballotLevel: 'CITY',
  positionName: 'Mayor',
  ballotReadyPositionId: 'br-100',
}

const ecanvasser = {
  contacts: [{}, {}, {}],
  interactions: [{}, {}],
  houses: [{}],
}

const campaign = {
  id: 42,
  slug: 'jane-doe-for-mayor',
  organizationSlug: 'campaign-42',
  isActive: false,
  isPro: true,
  userId: 7,
  aiContent: { intro: {}, bio: {} },
  data: {
    currentStep: 3,
    lastStepDate: '2024-01-15',
    createdBy: CampaignCreatedBy.ADMIN,
    adminUserEmail: 'admin@example.com',
    reportedVoterGoals: {
      calls: 10,
      directMail: 5,
      events: 2,
      doorKnocking: 3,
      digitalAds: 4,
      yardSigns: 1,
    },
    customVoterFiles: ['a', 'b'],
  },
  details: {
    zip: '90210',
    party: 'Independent',
    ballotLevel: 'CITY',
    state: 'CA',
    pledged: true,
    district: 'District 5',
    city: 'Beverly Hills',
    runForOffice: true,
    electionDate: '2024-11-05',
    primaryElectionDate: '2024-06-04',
    filingPeriodsStart: '2024-02-01',
    filingPeriodsEnd: '2024-03-01',
    isProUpdatedAt: '2024-01-10',
    raceId: 'race-99',
  },
} as unknown as Campaign

type CrmCampaignsInternals = {
  calculateCRMCompanyProperties(
    campaign: Campaign,
  ): Promise<Record<string, string> | null>
}

const calculate = (service: CrmCampaignsService, input: Campaign) =>
  (service as unknown as CrmCampaignsInternals).calculateCRMCompanyProperties(
    input,
  )

const buildService = (latency: Latency) => {
  const campaigns = {
    fetchLiveRaceTargetMetrics: vi.fn(async () => {
      await delay(latency.liveMetrics)
      return { winNumber: 1000, voterContactGoal: 3000 }
    }),
    client: {
      tcrCompliance: {
        findUnique: vi.fn(async () => {
          await delay(latency.tcr)
          return {
            email: 'tcr@example.com',
            phone: '5551234567',
            filingUrl: 'https://example.com/filing',
          }
        }),
      },
    },
  } as unknown as CampaignsService

  const users = {
    findByCampaign: vi.fn(async () => {
      await delay(latency.user)
      return user
    }),
  } as unknown as UsersService

  const organizations = {
    getCrmCompanyOrgContextByOrgSlug: vi.fn(async () => {
      await delay(latency.org)
      return orgContext
    }),
  } as unknown as OrganizationsService

  const aiChat = {
    count: vi.fn(async () => {
      await delay(latency.aiChat)
      return 5
    }),
  } as unknown as AiChatService

  const voterFile = {
    canDownload: vi.fn(() => true),
  } as unknown as VoterFileDownloadAccessService

  const ecanvasserService = {
    findByCampaignId: vi.fn(async () => {
      await delay(latency.ecanvasser)
      return ecanvasser
    }),
  } as unknown as EcanvasserIntegrationService

  const slack = { errorMessage: vi.fn() } as unknown as SlackService

  return new CrmCampaignsService(
    campaigns,
    users,
    {} as unknown as HubspotService,
    {} as never,
    organizations,
    aiChat,
    voterFile,
    slack,
    ecanvasserService,
    createMockLogger(),
  )
}

describe('CrmCampaignsService.calculateCRMCompanyProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('produces the expected property object (output unchanged by parallelization)', async () => {
    const result = await calculate(buildService(noLatency), campaign)

    expect(result).toEqual({
      calls_made: '10',
      direct_mail_sent: '5',
      event_impressions: '2',
      knocked_doors: '2',
      doors_knocked: '3',
      online_impressions: '4',
      yard_signs_impressions: '1',
      ecanvasser_contacts_count: '3',
      ecanvasser_houses_count: '1',
      candidate_district: 'District 5',
      candidate_email: 'jane@example.com',
      candidate_name: 'Jane Doe',
      name: 'Jane Doe',
      candidate_office: 'Mayor',
      office_level: 'CITY',
      candidate_party: 'Independent',
      candidate_state: 'California',
      state: 'California',
      city: 'Beverly Hills',
      zip: '90210',
      created_by_admin: HubSpot.CreatedByAdmin.YES,
      admin_user: 'admin@example.com',
      pledge_status: HubSpot.PledgeStatus.YES,
      pro_candidate: HubSpot.ProCandidate.YES,
      pro_subscription_status: HubSpot.ProSubStatus.ACTIVE,
      pro_upgrade_date: formatDateForCRM('2024-01-10'),
      running: HubSpot.Running.YES,
      n10_dlc_filing_email: 'tcr@example.com',
      n10_dlc_filing_phone: '5551234567',
      n10_dlc_filing_url: 'https://example.com/filing',
      br_position_id: 'br-100',
      br_race_id: 'race-99',
      election_date: formatDateForCRM('2024-11-05'),
      filing_deadline: formatDateForCRM('2024-03-01'),
      filing_start: formatDateForCRM('2024-02-01'),
      filing_end: formatDateForCRM('2024-03-01'),
      primary_date: formatDateForCRM('2024-06-04'),
      last_portal_visit: formatDateForCRM('2024-01-20'),
      last_step: '3',
      last_step_date: formatDateForCRM('2024-01-15'),
      campaign_assistant_chats: '5',
      my_content_pieces_created: '2',
      product_sessions: '12',
      voter_files_created: '2',
      voter_data_adoption: HubSpot.VoterDataAdoption.UNLOCKED,
      votegoal: '3000',
      win_number: '1000',
    })
  })

  it('returns identical output regardless of which dependency is slowest', async () => {
    const slowUser = await calculate(
      buildService({ ...noLatency, user: 30 }),
      campaign,
    )
    const slowOrg = await calculate(
      buildService({ ...noLatency, org: 30 }),
      campaign,
    )

    expect(slowUser).toEqual(slowOrg)
  })
})

describe('CrmCampaignsService.calculateCRMCompanyProperties benchmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Each leaf lookup simulates a realistic round-trip. The org context resolver
  // does an org-row fetch followed by an election-api position fetch, so it is
  // modelled at 2x a single leaf.
  const LEAF_MS = 40
  const benchLatency: Latency = {
    user: LEAF_MS,
    aiChat: LEAF_MS,
    liveMetrics: LEAF_MS,
    org: LEAF_MS * 2,
    tcr: LEAF_MS,
    ecanvasser: LEAF_MS,
  }

  it('runs concurrently: parallel wall time is far below the sequential sum', async () => {
    // BEFORE: the previous implementation awaited every lookup in series,
    // including two separate org-row + position round-trips (no dedup).
    const before = await measure(async () => {
      await delay(benchLatency.user)
      await delay(benchLatency.aiChat)
      await delay(benchLatency.liveMetrics)
      await delay(LEAF_MS * 2) // getDistrictAndBallotLevelForOrgSlug
      await delay(LEAF_MS * 2) // resolvePositionContextByOrgSlug (duplicate)
      await delay(benchLatency.tcr)
      await delay(benchLatency.ecanvasser)
    })

    // AFTER: the real method fetches everything concurrently and resolves the
    // org row + position once.
    const service = buildService(benchLatency)
    const after = await measure(async () => {
      await calculate(service, campaign)
    })

    const sequentialSum =
      benchLatency.user +
      benchLatency.aiChat +
      benchLatency.liveMetrics +
      LEAF_MS * 2 +
      LEAF_MS * 2 +
      benchLatency.tcr +
      benchLatency.ecanvasser

    console.log(
      `[benchmark] BEFORE sequential ≈ ${before.toFixed(0)}ms ` +
        `(sum of latencies ${sequentialSum}ms), ` +
        `AFTER parallel+dedup ≈ ${after.toFixed(0)}ms ` +
        `(≈ max latency ${benchLatency.org}ms)`,
    )

    expect(before).toBeGreaterThan(sequentialSum * 0.9)
    expect(after).toBeLessThan(before * 0.6)
    expect(after).toBeGreaterThan(benchLatency.org * 0.8)
  })
})

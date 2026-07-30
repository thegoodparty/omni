import { Test } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenException } from '@nestjs/common'
import { subMinutes } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { RecommendedLists } from '@goodparty_org/contracts'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { FeaturesService } from '@/features/services/features.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { RECOMMENDED_LISTS_DATABRICKS } from '../recommendedLists.constants'
import { RecommendedListsService } from './recommendedLists.service'

type Snapshot = Record<string, unknown>

const CAMPAIGN_ID = 42
const USER_ID = 7
const RACE_ID = 'race-1'

const VALID_LISTS: RecommendedLists = {
  meta: {
    officeName: 'County Commissioner District 5',
    state: 'MN',
    districtType: 'County_Commissioner_District',
    districtName: 'SCOTT CNTY COMM DIST 5',
    districtLabel: 'SCOTT CNTY COMM DIST 5, MN',
    registeredVoters: 41230,
    projectedTurnout: 18400,
    votesNeeded: 9201,
    electionCode: 'General',
    electionDate: '2026-11-03',
    subGeoLabel: 'municipalities',
    doorRatio: 0.62,
  },
  lists: [
    {
      variant: 'voterSupportId',
      goal: 'introduction',
      name: 'Candidate Intro & Voter Support ID',
      priority: 1,
      allowedOutreachTypes: ['doorKnocking'],
      allowedPhases: ['earlyCampaign', 'midCampaign'],
      details: {
        votescoreThreshold: 3,
        voterCount: 18500,
        doorCount: 11470,
        estimatedHours: 764.7,
        turfs: [{ area: 'SHAKOPEE', voterCount: 7200 }],
      },
    },
  ],
}

const LEGACY_KIND_LISTS = {
  meta: VALID_LISTS.meta,
  lists: [
    {
      kind: 'issueAligned',
      name: 'Voters who lean toward Protecting local water quality',
      priority: 2,
      allowedOutreachTypes: ['doorKnocking', 'phone', 'email', 'directMail'],
      allowedPhases: ['midCampaign'],
      details: {
        phrase: 'Protecting local water quality',
        opponentName: 'Jane Doe',
        threatTier: 'high',
        activeVoters: 30500,
        supporters: 12000,
        opponents: 4000,
        persuadable: 14500,
        supportersPlausible: 8000,
      },
    },
  ],
}

const makeCampaign = (
  overrides: Record<string, unknown> = {},
): CampaignWith<'user'> =>
  ({
    id: CAMPAIGN_ID,
    userId: USER_ID,
    isPro: true,
    organizationSlug: 'org-1',
    details: { raceId: RACE_ID },
    user: { id: USER_ID },
    ...overrides,
  }) as unknown as CampaignWith<'user'>

interface SetupOptions {
  snapshot?: Snapshot | null
  featureEnabled?: boolean
  databricks?: { query: ReturnType<typeof vi.fn> } | null
}

const setup = async (options: SetupOptions = {}) => {
  const snapshotDelegate = {
    findUnique: vi.fn().mockResolvedValue(options.snapshot ?? null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    count: vi.fn(),
  }
  const prisma = { recommendedListsSnapshot: snapshotDelegate }
  const features = {
    isFeatureEnabled: vi.fn().mockResolvedValue(options.featureEnabled ?? true),
  }
  const sendMessage = vi.fn().mockResolvedValue(undefined)
  const queueProducer = { sendMessage }
  const databricks =
    options.databricks === undefined ? { query: vi.fn() } : options.databricks

  const moduleRef = await Test.createTestingModule({
    providers: [
      RecommendedListsService,
      { provide: PrismaService, useValue: prisma },
      { provide: PinoLogger, useValue: createMockLogger() },
      { provide: FeaturesService, useValue: features },
      { provide: QueueProducerService, useValue: queueProducer },
      { provide: RECOMMENDED_LISTS_DATABRICKS, useValue: databricks },
    ],
  }).compile()

  return {
    service: moduleRef.get(RecommendedListsService),
    snapshotDelegate,
    features,
    sendMessage,
  }
}

describe('RecommendedListsService.getForCampaign', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a non-Pro campaign with a 403', async () => {
    const { service, snapshotDelegate } = await setup()
    await expect(
      service.getForCampaign(makeCampaign({ isPro: false })),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(snapshotDelegate.findUnique).not.toHaveBeenCalled()
  })

  it('rejects when the recommended-lists feature is disabled', async () => {
    const { service } = await setup({ featureEnabled: false })
    await expect(service.getForCampaign(makeCampaign())).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('reports unavailable when the Win warehouse is not configured', async () => {
    const { service, snapshotDelegate } = await setup({ databricks: null })
    const result = await service.getForCampaign(makeCampaign())
    expect(result).toEqual({ status: 'unavailable' })
    expect(snapshotDelegate.findUnique).not.toHaveBeenCalled()
  })

  it('creates a pending snapshot and enqueues a recompute on first read', async () => {
    const { service, snapshotDelegate, sendMessage } = await setup({
      snapshot: null,
    })

    const result = await service.getForCampaign(makeCampaign())

    expect(result).toEqual({ status: 'pending' })
    expect(snapshotDelegate.create).toHaveBeenCalledWith({
      data: {
        campaignId: CAMPAIGN_ID,
        status: 'pending',
        raceId: RACE_ID,
        attempts: 1,
        startedAt: expect.any(Date),
      },
    })
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: 'recommendedListsRecompute',
        data: { campaignId: CAMPAIGN_ID, raceId: RACE_ID, attempt: 1 },
      },
      `recommended-lists-${CAMPAIGN_ID}`,
      { deduplicationId: `${CAMPAIGN_ID}:${RACE_ID}:1` },
    )
  })

  it('returns the lists from a ready snapshot whose race still matches', async () => {
    const computedAt = new Date('2026-07-23T12:00:00.000Z')
    const { service, sendMessage } = await setup({
      snapshot: {
        campaignId: CAMPAIGN_ID,
        status: 'ready',
        raceId: RACE_ID,
        computedAt,
        payload: VALID_LISTS,
      },
    })

    const result = await service.getForCampaign(makeCampaign())

    expect(result).toEqual({
      status: 'ready',
      computedAt: '2026-07-23T12:00:00.000Z',
      lists: VALID_LISTS,
    })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('resets a ready snapshot to pending when its payload no longer parses', async () => {
    const { service, snapshotDelegate, sendMessage } = await setup({
      snapshot: {
        campaignId: CAMPAIGN_ID,
        status: 'ready',
        raceId: RACE_ID,
        computedAt: new Date(),
        payload: { meta: 'not a valid lists payload' },
      },
    })

    const result = await service.getForCampaign(makeCampaign())

    expect(result).toEqual({ status: 'pending' })
    expect(snapshotDelegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: CAMPAIGN_ID },
        data: expect.objectContaining({ status: 'pending', attempts: 1 }),
      }),
    )
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('resets a ready snapshot carrying a legacy kind-shaped payload to pending', async () => {
    const { service, snapshotDelegate, sendMessage } = await setup({
      snapshot: {
        campaignId: CAMPAIGN_ID,
        status: 'ready',
        raceId: RACE_ID,
        computedAt: new Date(),
        payload: LEGACY_KIND_LISTS,
      },
    })

    const result = await service.getForCampaign(makeCampaign())

    expect(result).toEqual({ status: 'pending' })
    expect(snapshotDelegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: CAMPAIGN_ID },
        data: expect.objectContaining({ status: 'pending', attempts: 1 }),
      }),
    )
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('resets to pending and re-stamps the race when the campaign race changed', async () => {
    const { service, snapshotDelegate, sendMessage } = await setup({
      snapshot: {
        campaignId: CAMPAIGN_ID,
        status: 'ready',
        raceId: 'stale-race',
        computedAt: new Date(),
        payload: VALID_LISTS,
      },
    })

    const result = await service.getForCampaign(makeCampaign())

    expect(result).toEqual({ status: 'pending' })
    expect(snapshotDelegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending',
          raceId: RACE_ID,
          attempts: 1,
        }),
      }),
    )
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { campaignId: CAMPAIGN_ID, raceId: RACE_ID, attempt: 1 },
      }),
      `recommended-lists-${CAMPAIGN_ID}`,
      { deduplicationId: `${CAMPAIGN_ID}:${RACE_ID}:1` },
    )
  })

  it('re-enqueues and increments attempts for a pending snapshot past its TTL', async () => {
    const { service, snapshotDelegate, sendMessage } = await setup({
      snapshot: {
        campaignId: CAMPAIGN_ID,
        status: 'pending',
        raceId: RACE_ID,
        startedAt: subMinutes(new Date(), 20),
        attempts: 1,
      },
    })

    const result = await service.getForCampaign(makeCampaign())

    expect(result).toEqual({ status: 'pending' })
    expect(snapshotDelegate.update).toHaveBeenCalledWith({
      where: { campaignId: CAMPAIGN_ID },
      data: { attempts: 2, startedAt: expect.any(Date) },
    })
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { campaignId: CAMPAIGN_ID, raceId: RACE_ID, attempt: 2 },
      }),
      `recommended-lists-${CAMPAIGN_ID}`,
      { deduplicationId: `${CAMPAIGN_ID}:${RACE_ID}:2` },
    )
  })

  it('reports failed once a stale pending snapshot exhausts its attempts', async () => {
    const { service, snapshotDelegate, sendMessage } = await setup({
      snapshot: {
        campaignId: CAMPAIGN_ID,
        status: 'pending',
        raceId: RACE_ID,
        startedAt: subMinutes(new Date(), 20),
        attempts: 3,
      },
    })

    const result = await service.getForCampaign(makeCampaign())

    expect(result).toEqual({ status: 'failed' })
    expect(snapshotDelegate.update).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('leaves a freshly-started pending snapshot alone', async () => {
    const { service, snapshotDelegate, sendMessage } = await setup({
      snapshot: {
        campaignId: CAMPAIGN_ID,
        status: 'pending',
        raceId: RACE_ID,
        startedAt: subMinutes(new Date(), 2),
        attempts: 1,
      },
    })

    const result = await service.getForCampaign(makeCampaign())

    expect(result).toEqual({ status: 'pending' })
    expect(snapshotDelegate.update).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('reports failed for a terminally failed snapshot', async () => {
    const { service, sendMessage } = await setup({
      snapshot: {
        campaignId: CAMPAIGN_ID,
        status: 'failed',
        raceId: RACE_ID,
        startedAt: new Date(),
        attempts: 1,
      },
    })

    const result = await service.getForCampaign(makeCampaign())

    expect(result).toEqual({ status: 'failed' })
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { useTestService } from '@/test-service'
import { ExperimentRunStatus } from '@/generated/prisma'
import { RACE_OPPONENT_ACTIONS } from '../raceOpponent.constants'
import { RaceOpponentPersistService } from './raceOpponentPersist.service'

const service = useTestService()

const SLUG = 'test-org-standout'
const BUCKET = 'gp-agent-artifacts-dev'

const seedCampaign = async (slug = SLUG) => {
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${slug}-campaign`,
      organizationSlug: slug,
      isPro: true,
    },
  })
}

const seedRun = async (
  artifactKey: string,
  overrides: {
    artifactBucket?: string | null
    artifactKey?: string | null
  } = {},
) =>
  service.prisma.experimentRun.create({
    data: {
      organizationSlug: SLUG,
      experimentType: RACE_OPPONENT_ACTIONS,
      status: ExperimentRunStatus.COMPLETED,
      artifactBucket:
        overrides.artifactBucket === undefined
          ? BUCKET
          : overrides.artifactBucket,
      artifactKey:
        overrides.artifactKey === undefined
          ? artifactKey
          : overrides.artifactKey,
    },
  })

const mockS3 = (responses: Record<string, string | undefined>) =>
  vi
    .spyOn(service.app.get(S3Service), 'getFile')
    .mockImplementation(async (_bucket, key) => responses[key])

// Snake_case Haystaq block as the actions agent emits it in the artifact.
const validHaystaq = {
  hs_column: 'hs_infrastructure_support',
  position_phrase: 'funding infrastructure more',
  position_dir: 'high',
  total_active: 12000,
  voter_count_ge50: 6400,
  voter_percentage_ge50: 53.3,
  voter_count_ge70: 3100,
  voter_percentage_ge70: 25.8,
}

const card = (overrides: Record<string, unknown> = {}) => ({
  title: 'Knock the north precinct',
  body: 'Your opponent skipped the last three council votes on road repair.',
  sms_message: 'Hi, this is Jane — I show up for every road-repair vote.',
  opponent_name: 'John Smith',
  issue: 'infrastructure',
  ...overrides,
})

const persist = () => service.app.get(RaceOpponentPersistService)

const rows = (campaignId: number) =>
  service.prisma.raceOpponentStandoutAction.findMany({
    where: { campaignId },
    orderBy: { order: 'asc' },
  })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RaceOpponentPersistService haystaq persistence', () => {
  let campaignId: number

  beforeEach(async () => {
    campaignId = (await seedCampaign()).id
  })

  it('persists all eight haystaq columns from a full snake_case block', async () => {
    const key = 'race_opponent_actions/run-full/artifact.json'
    const run = await seedRun(key)
    mockS3({
      [key]: JSON.stringify({ actions: [card({ haystaq: validHaystaq })] }),
    })

    await persist().onExperimentRunCompleted(run)

    const [row] = await rows(campaignId)
    expect(row).toMatchObject({
      title: 'Knock the north precinct',
      issue: 'infrastructure',
      hsColumn: 'hs_infrastructure_support',
      positionPhrase: 'funding infrastructure more',
      positionDir: 'high',
      haystaqTotalActive: 12000,
      haystaqCountGe50: 6400,
      haystaqPctGe50: 53.3,
      haystaqCountGe70: 3100,
      haystaqPctGe70: 25.8,
    })
  })

  it('persists null haystaq columns when haystaq is null', async () => {
    const key = 'race_opponent_actions/run-null/artifact.json'
    const run = await seedRun(key)
    mockS3({
      [key]: JSON.stringify({ actions: [card({ haystaq: null })] }),
    })

    await persist().onExperimentRunCompleted(run)

    const [row] = await rows(campaignId)
    expect(row).toMatchObject({
      title: 'Knock the north precinct',
      hsColumn: null,
      positionPhrase: null,
      positionDir: null,
      haystaqTotalActive: null,
      haystaqCountGe50: null,
      haystaqPctGe50: null,
      haystaqCountGe70: null,
      haystaqPctGe70: null,
    })
  })

  it('persists null haystaq columns for a legacy card without the key', async () => {
    const key = 'race_opponent_actions/run-legacy/artifact.json'
    const run = await seedRun(key)
    mockS3({ [key]: JSON.stringify({ actions: [card()] }) })

    await persist().onExperimentRunCompleted(run)

    const [row] = await rows(campaignId)
    expect(row).toMatchObject({
      title: 'Knock the north precinct',
      hsColumn: null,
      haystaqTotalActive: null,
      haystaqPctGe70: null,
    })
  })

  it('keeps the card and nulls haystaq columns when the block is malformed', async () => {
    const warn = vi.spyOn(PinoLogger.prototype, 'warn')
    const key = 'race_opponent_actions/run-bad/artifact.json'
    const run = await seedRun(key)
    mockS3({
      [key]: JSON.stringify({
        actions: [card({ haystaq: { ...validHaystaq, hs_column: '' } })],
      }),
    })

    await persist().onExperimentRunCompleted(run)

    const persisted = await rows(campaignId)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      title: 'Knock the north precinct',
      issue: 'infrastructure',
      hsColumn: null,
      positionPhrase: null,
      haystaqTotalActive: null,
    })
    expect(
      warn.mock.calls.some((call) => JSON.stringify(call).includes('haystaq')),
    ).toBe(true)
  })
})

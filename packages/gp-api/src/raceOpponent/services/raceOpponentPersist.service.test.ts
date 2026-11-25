import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { useTestService } from '@/test-service'
import { ExperimentRunStatus } from '@/generated/prisma'
import {
  RACE_OPPONENT_ACTIONS,
  RACE_OPPONENT_COLLECTION,
  RACE_OPPONENT_SUMMARY,
} from '../raceOpponent.constants'
import { RaceOpponentPersistService } from './raceOpponentPersist.service'
import { RaceOpponentService } from './raceOpponent.service'
import type { RaceOpponentActionsOutput } from '../raceOpponentActionsAgent/race_opponent_actions.schema'

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

// The gp-api hooks receive the run's validated output, so this is the agent's
// own output type, not the looser snake_case JSON the PMF path reads from S3.
const actionsArtifact = (): RaceOpponentActionsOutput => ({
  generated_at: '2026-11-25T00:00:00Z',
  haystaq_status: 'no_district',
  actions: [
    {
      title: 'Knock the north precinct',
      body: 'Your opponent skipped the last three council votes on road repair.',
      sms_message: 'Hi, this is Jane — I show up for every road-repair vote.',
      opponent_name: 'John Smith',
      issue: 'infrastructure',
      haystaq: null,
    },
  ],
})

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

// The gp-api completion hooks: the engine hands them the run's already-validated
// output, so there is no S3 read. They are the whole reason a gp-api run lands
// where a PMF run does, and until now nothing drove them.
describe('the gp-api completion hooks persist where the PMF consumer does', () => {
  let campaign: { id: number }

  beforeEach(async () => {
    campaign = await seedCampaign()
  })

  const seedAgentRun = async (agentName: string, slug = SLUG) =>
    service.prisma.agentRun.create({
      data: {
        agentName,
        organizationSlug: slug,
        status: 'running',
        manifest: {},
        shapeHash: 'test',
        input: { organizationSlug: slug },
      },
    })

  it('persists the collection artifact into RaceOpponent rows', async () => {
    const run = await seedAgentRun(RACE_OPPONENT_COLLECTION)

    await persist().onCollectionArtifact({
      runId: run.id,
      artifact: {
        generated_at: '2026-11-25T00:00:00Z',
        items: [
          {
            opponent_name: 'Jane Rival',
            source_type: 'ballotpedia',
            source_url: 'https://ballotpedia.org/Jane_Rival',
            content: { text: 'collected bio' },
          },
        ],
      },
    })

    const persisted = await service.prisma.raceOpponent.findMany({
      where: { campaignId: campaign.id },
    })
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      opponentName: 'Jane Rival',
      sourceType: 'ballotpedia',
      sourceUrl: 'https://ballotpedia.org/Jane_Rival',
    })
  })

  // The hooks are keyed on the agent name, so a run of another agent must not
  // write this link's rows.
  it('ignores a collection artifact from another agent', async () => {
    const run = await seedAgentRun(RACE_OPPONENT_SUMMARY)

    await persist().onCollectionArtifact({
      runId: run.id,
      artifact: {
        generated_at: '2026-11-25T00:00:00Z',
        items: [
          {
            opponent_name: 'Jane Rival',
            source_type: 'ballotpedia',
            source_url: 'https://ballotpedia.org/Jane_Rival',
            content: { text: 'collected bio' },
          },
        ],
      },
    })

    expect(
      await service.prisma.raceOpponent.findMany({
        where: { campaignId: campaign.id },
      }),
    ).toHaveLength(0)
  })

  // No campaign for the org means nothing to write; the hook returns rather
  // than throwing, because a throw here fails an otherwise-good run.
  it('returns without writing when the org has no campaign', async () => {
    await service.prisma.organization.create({
      data: { slug: 'no-campaign', ownerId: service.user.id },
    })
    const run = await seedAgentRun(RACE_OPPONENT_COLLECTION, 'no-campaign')

    await expect(
      persist().onCollectionArtifact({
        runId: run.id,
        artifact: { generated_at: '2026-11-25T00:00:00Z', items: [] },
      }),
    ).resolves.toBeUndefined()
    expect(
      await service.prisma.raceOpponent.findMany({
        where: { campaignId: campaign.id },
      }),
    ).toHaveLength(0)
  })

  // The summary hook runs the shared persist body and then chains actions off
  // it, so the summary rows land where the PMF consumer's do.
  it('persists the summary artifact and chains the actions run', async () => {
    const run = await seedAgentRun(RACE_OPPONENT_SUMMARY)
    await service.prisma.raceOpponent.create({
      data: {
        campaignId: campaign.id,
        runId: 'collect-run',
        opponentName: 'Jane Rival',
        sourceType: 'ballotpedia',
        sourceUrl: 'https://ballotpedia.org/Jane_Rival',
        content: { text: 'collected bio' },
      },
    })
    const dispatchActions = vi
      .spyOn(service.app.get(RaceOpponentService), 'dispatchActions')
      .mockResolvedValue()

    await persist().onSummaryArtifact({
      runId: run.id,
      artifact: {
        generated_at: '2026-11-25T00:00:00Z',
        opponents: [
          {
            opponent_name: 'Jane Rival',
            threat_tier: 'primary_threat',
            overview: {
              text: 'A rival.',
              sources: [
                {
                  url: 'https://ballotpedia.org/Jane_Rival',
                  title: 'Jane Rival',
                  publisher: 'Ballotpedia',
                },
              ],
            },
          },
        ],
      },
    })

    const persisted = await service.prisma.raceOpponentSummary.findMany({
      where: { campaignId: campaign.id },
    })
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ opponentName: 'Jane Rival' })
    expect(dispatchActions).toHaveBeenCalledWith(
      expect.objectContaining({ id: campaign.id }),
    )
  })

  it('persists the actions artifact as stand-out cards', async () => {
    const run = await seedAgentRun(RACE_OPPONENT_ACTIONS)

    await persist().onActionsArtifact({
      runId: run.id,
      artifact: actionsArtifact(),
    })

    const persisted = await rows(campaign.id)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ title: 'Knock the north precinct' })
  })

  // The actions hook re-chains on completion with its own run id, so a summary
  // that landed while this run was in flight still gets its cards rebuilt.
  it('re-chains after the actions artifact, excluding its own run', async () => {
    const run = await seedAgentRun(RACE_OPPONENT_ACTIONS)
    const rechain = vi
      .spyOn(
        service.app.get(RaceOpponentService),
        'rechainActionsForNewerSummary',
      )
      .mockResolvedValue()

    await persist().onActionsArtifact({
      runId: run.id,
      artifact: actionsArtifact(),
    })

    expect(rechain).toHaveBeenCalledTimes(1)
    const [chainedCampaign, at, exceptRunId] = rechain.mock.calls[0] ?? []
    expect(chainedCampaign?.id).toBe(campaign.id)
    expect(at).toEqual(run.createdAt)
    expect(exceptRunId).toBe(run.id)
  })
})

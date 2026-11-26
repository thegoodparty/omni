import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { useTestService } from '@/test-service'
import { TRACKER_GENERATION_ADVISORY_LOCK_KEY } from '../../campaigns.consts'
import {
  CampaignTrackerTask,
  ExperimentRunStatus,
} from '../../../generated/prisma'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  CampaignTrackerTasksService,
  trackerArtifactSchema,
} from '../services/campaignTrackerTasks.service'

const service = useTestService()

// The manifest's output schema, as either engine hands it over.
const ARTIFACT: z.infer<typeof trackerArtifactSchema> = {
  generated_at: '2026-11-26T00:00:00Z',
  tasks: [
    {
      kind: 'task',
      catalog_id: 'get-ein',
      title: 'Get your EIN',
      description: 'Apply for your federal tax ID.',
      phase: 'preLaunch',
      channel: 'general',
      date: null,
      address: null,
      url: null,
    },
    {
      kind: 'event',
      catalog_id: null,
      title: 'Ward 2 town hall',
      description: 'Meet the neighbors.',
      phase: 'active',
      channel: 'event',
      date: '2026-12-05',
      address: null,
      url: 'https://example.test/event',
    },
  ],
}

const seedCampaign = async () => {
  const slug = `tracker-source-run-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug,
      organizationSlug: slug,
      isActive: true,
      details: { electionDate: '2099-11-03' },
    },
  })
}

const dynamicRows = (campaignId: number) =>
  service.prisma.campaignTrackerTask.findMany({
    where: { campaignId, isDefaultTask: false },
    orderBy: [{ week: 'asc' }, { title: 'asc' }],
  })

const pmfRun = (organizationSlug: string, runId = `run-${randomUUID()}`) =>
  ({
    runId,
    status: ExperimentRunStatus.COMPLETED,
    experimentType: 'campaign_tracker_tasks',
    organizationSlug,
    artifactBucket: 'bucket',
    artifactKey: 'key',
  }) as never

const stubArtifact = () =>
  vi
    .spyOn(service.app.get(S3Service), 'getFile')
    .mockResolvedValue(JSON.stringify(ARTIFACT))

afterEach(() => {
  vi.restoreAllMocks()
})

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

// The result job is at-least-once (an SQS redelivery, a retried consumer), and
// onArtifact re-runs from the stored artifact when an attempt died after it, so
// the same completed run reaches the append more than once. Appending twice
// would hand the candidate two generations for one week.
describe('a tracker generation appends once per run', () => {
  it('stamps its rows with the run that produced them', async () => {
    const campaign = await seedCampaign()
    stubArtifact()
    const runId = `run-${randomUUID()}`

    await service.app
      .get(CampaignTrackerTasksService)
      .onExperimentRunCompleted(pmfRun(campaign.organizationSlug ?? '', runId))

    const rows = await dynamicRows(campaign.id)
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.sourceRunId === runId)).toBe(true)
    expect(new Set(rows.map((row) => row.week))).toEqual(new Set([1]))
  })

  it('appends nothing the second time the same run delivers', async () => {
    const campaign = await seedCampaign()
    stubArtifact()
    const run = pmfRun(campaign.organizationSlug ?? '')
    const tracker = service.app.get(CampaignTrackerTasksService)

    await tracker.onExperimentRunCompleted(run)
    await tracker.onExperimentRunCompleted(run)

    expect(await dynamicRows(campaign.id)).toHaveLength(2)
  })

  // The replay check alone is a read-then-insert: two deliveries that both read
  // before either writes each see no stamp and each append. The advisory lock is
  // what makes the second delivery wait, so this holds the campaign's lock on
  // another connection and proves the append blocks on it rather than inserting.
  it('waits on the campaign lock an overlapping append holds', async () => {
    const campaign = await seedCampaign()
    stubArtifact()

    let releaseHolder: (value: void) => void = () => undefined
    const held = new Promise<void>((resolve) => {
      releaseHolder = resolve
    })
    let holderHasLock: (value: void) => void = () => undefined
    const lockTaken = new Promise<void>((resolve) => {
      holderHasLock = resolve
    })
    const holder = service.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRACKER_GENERATION_ADVISORY_LOCK_KEY}::integer, ${campaign.id}::integer)`
      holderHasLock()
      await held
    })
    await lockTaken

    const append = service.app
      .get(CampaignTrackerTasksService)
      .onExperimentRunCompleted(pmfRun(campaign.organizationSlug ?? ''))
    await sleep(750)
    expect(await dynamicRows(campaign.id)).toHaveLength(0)

    releaseHolder()
    await holder
    await append
    expect(await dynamicRows(campaign.id)).toHaveLength(2)
  })

  // Reaching the same state the lock produces, without racing for it: the first
  // delivery's rows are down, so the second one's read finds the stamp.
  it('skips a run whose rows an earlier delivery already committed', async () => {
    const campaign = await seedCampaign()
    stubArtifact()
    const runId = `run-${randomUUID()}`
    await service.prisma.campaignTrackerTask.create({
      data: {
        campaignId: campaign.id,
        title: 'Get your EIN',
        description: 'Apply for your federal tax ID.',
        week: 1,
        date: new Date('2099-01-05T00:00:00.000Z'),
        isDefaultTask: false,
        sourceRunId: runId,
      },
    })

    await service.app
      .get(CampaignTrackerTasksService)
      .onExperimentRunCompleted(pmfRun(campaign.organizationSlug ?? '', runId))

    expect(await dynamicRows(campaign.id)).toHaveLength(1)
  })

  // A different run is the next generation, not a replay: appending a new week
  // beside the previous one is the weekly cron's whole job.
  it('appends the next generation for a different run', async () => {
    const campaign = await seedCampaign()
    stubArtifact()
    const tracker = service.app.get(CampaignTrackerTasksService)

    await tracker.onExperimentRunCompleted(
      pmfRun(campaign.organizationSlug ?? ''),
    )
    await tracker.onExperimentRunCompleted(
      pmfRun(campaign.organizationSlug ?? ''),
    )

    const rows = await dynamicRows(campaign.id)
    expect(rows).toHaveLength(4)
    expect(new Set(rows.map((row) => row.week))).toEqual(new Set([1, 2]))
  })

  it('appends nothing when onArtifact runs again for the same run', async () => {
    const campaign = await seedCampaign()
    const tracker = service.app.get(CampaignTrackerTasksService)
    const run = {
      runId: `run-${randomUUID()}`,
      organizationSlug: campaign.organizationSlug ?? '',
    }

    await tracker.onTrackerArtifact(run, ARTIFACT)
    await tracker.onTrackerArtifact(run, ARTIFACT)

    expect(await dynamicRows(campaign.id)).toHaveLength(2)
  })
})

// A generation completes two ways: gp-api's engine calls onArtifact with the
// run's own output, the PMF Engine's result consumer appends from the S3
// artifact. Both are the product's, so a rollback either way has to land the
// same rows.
describe('both completion paths append the same rows', () => {
  it('writes one generation either way', async () => {
    const fromGpApi = await seedCampaign()
    const fromPmf = await seedCampaign()
    stubArtifact()
    const tracker = service.app.get(CampaignTrackerTasksService)

    await tracker.onTrackerArtifact(
      {
        runId: `run-${randomUUID()}`,
        organizationSlug: fromGpApi.organizationSlug ?? '',
      },
      ARTIFACT,
    )
    await tracker.onExperimentRunCompleted(
      pmfRun(fromPmf.organizationSlug ?? ''),
    )

    // Everything but the row's own identity: two campaigns' rows differ by id,
    // campaign and the run they came from, and the content is what must match.
    const content = ({
      title,
      description,
      phase,
      flowType,
      week,
      date,
      link,
      isDefaultTask,
      completed,
    }: CampaignTrackerTask) => ({
      title,
      description,
      phase,
      flowType,
      week,
      date: date.toISOString(),
      link,
      isDefaultTask,
      completed,
    })
    expect((await dynamicRows(fromGpApi.id)).map(content)).toEqual(
      (await dynamicRows(fromPmf.id)).map(content),
    )
  })
})

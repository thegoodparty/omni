import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CampaignStrategyService } from '@/campaignStrategy/services/campaignStrategy.service'
import { ExperimentRunStatus } from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { OrdinanceCodePersistService } from '@/ordinances/services/ordinanceCodePersist.service'
import type { AgentExperimentResultData } from '@/queue/queue.types'
import { useTestService } from '@/test-service'

const service = useTestService({ jobs: true })

let slug: string

beforeEach(async () => {
  slug = `org-agent-result-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
})

const seedRun = (status: ExperimentRunStatus, experimentType = 'test_type') =>
  service.prisma.experimentRun.create({
    data: { organizationSlug: slug, experimentType, status },
  })

const runStatus = async (runId: string) =>
  (await service.prisma.experimentRun.findUniqueOrThrow({ where: { runId } }))
    .status

// What the SQS consumer does with an agentExperimentResult message.
const receive = (data: AgentExperimentResultData) =>
  service.app
    .get(JobsService)
    .sendMany('agentExperimentResult', [
      { data, key: randomUUID(), group: data.runId },
    ])

describe('the agentExperimentResult job', () => {
  it('moves a QUEUED run to RUNNING on started', async () => {
    const run = await seedRun(ExperimentRunStatus.QUEUED)

    await receive({ runId: run.runId, status: 'started' })
    await service.jobs.settle()

    expect(await runStatus(run.runId)).toBe(ExperimentRunStatus.RUNNING)
  })

  it('fails a still-QUEUED run on a failed result', async () => {
    const run = await seedRun(ExperimentRunStatus.QUEUED)

    await receive({ runId: run.runId, status: 'failed', error: 'boom' })
    await service.jobs.settle()

    const row = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: run.runId },
    })
    expect(row.status).toBe(ExperimentRunStatus.FAILED)
    expect(row.error).toBe('boom')
  })

  it.each([ExperimentRunStatus.COMPLETED, ExperimentRunStatus.SUPERSEDED])(
    'leaves a %s run as it is when a late result arrives',
    async (status) => {
      const run = await seedRun(status)

      await receive({ runId: run.runId, status: 'failed', error: 'late' })
      await service.jobs.settle()

      expect(await runStatus(run.runId)).toBe(status)
    },
  )

  it('completes for a run that does not exist', async () => {
    await receive({ runId: randomUUID(), status: 'success' })

    await service.jobs.settle()
  })

  it('hands the completed run to the ordinance persist hook', async () => {
    const run = await seedRun(
      ExperimentRunStatus.RUNNING,
      'find_existing_ordinances',
    )
    const persist = vi
      .spyOn(
        service.app.get(OrdinanceCodePersistService),
        'onExperimentRunCompleted',
      )
      .mockResolvedValue(undefined)

    await receive({ runId: run.runId, status: 'success' })
    await service.jobs.settle()

    expect(persist).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        runId: run.runId,
        status: ExperimentRunStatus.COMPLETED,
      }),
    )
  })

  it('fails the attempt when a persist hook throws, and the retry finds the run terminal', async () => {
    const run = await seedRun(ExperimentRunStatus.RUNNING)
    const persist = vi
      .spyOn(
        service.app.get(CampaignStrategyService),
        'onExperimentRunCompleted',
      )
      .mockRejectedValueOnce(new Error('persist boom'))

    await receive({ runId: run.runId, status: 'success' })
    await service.jobs.settle()

    expect(persist).toHaveBeenCalledTimes(1)
    expect(await runStatus(run.runId)).toBe(ExperimentRunStatus.COMPLETED)
  })
})

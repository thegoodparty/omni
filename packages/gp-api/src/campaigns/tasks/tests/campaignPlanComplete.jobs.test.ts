import { randomUUID } from 'node:crypto'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import { CampaignTaskType } from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { campaignPlanQueueConfig } from '@/queue/queue.config'
import type { CampaignPlanCompleteMessage } from '@/queue/queue.types'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'

const service = useTestService({ jobs: true })

const BUCKET = 'campaign-plan-results-test'
const S3_KEY = 'results/plan.json'

let campaignId: number
let getFile: Mock<S3Service['getFile']>

beforeEach(async () => {
  campaignPlanQueueConfig.resultsBucket = BUCKET
  const slug = `campaign-plan-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug,
      details: { electionDate: '2099-11-05' },
      organizationSlug: slug,
    },
  })
  campaignId = campaign.id
  getFile = vi.fn<S3Service['getFile']>(async (bucket, key) =>
    bucket === BUCKET && key === S3_KEY
      ? JSON.stringify({
          campaignId,
          taskCount: 1,
          generationTimestamp: '2099-01-01T00:00:00Z',
          tasks: [
            {
              title: 'Knock doors downtown',
              description: 'Meet voters on Main St',
              cta: 'Start',
              flowType: CampaignTaskType.doorKnocking,
              week: 3,
              date: '2099-10-01',
            },
          ],
        })
      : undefined,
  )
  vi.spyOn(service.app.get(S3Service), 'getFile').mockImplementation(getFile)
})

afterEach(() => {
  campaignPlanQueueConfig.resultsBucket = ''
})

// What the SQS consumer does with a campaignPlanComplete message.
const receive = (data: CampaignPlanCompleteMessage) =>
  service.app
    .get(JobsService)
    .sendMany('campaignPlanComplete', [
      { data, key: randomUUID(), group: String(data.campaignId) },
    ])

const taskTitles = async () =>
  (
    await service.prisma.campaignTask.findMany({
      where: { campaignId },
      select: { title: true },
    })
  ).map((task) => task.title)

describe('the campaignPlanComplete job', () => {
  it('saves the plan tasks from S3', async () => {
    await receive({ campaignId, status: 'completed', s3Key: S3_KEY })
    await service.jobs.settle()

    expect(await taskTitles()).toEqual(['Knock doors downtown'])
  })

  it('saves nothing for a failed generation', async () => {
    await receive({ campaignId, status: 'error', error: 'generation failed' })
    await service.jobs.settle()

    expect(getFile).not.toHaveBeenCalled()
    expect(await taskTitles()).toEqual([])
  })

  it('completes without a dead letter when the campaign is gone', async () => {
    await service.prisma.campaign.delete({ where: { id: campaignId } })

    await receive({ campaignId, status: 'completed', s3Key: S3_KEY })
    const { deadLetters } = await service.jobs.settle({
      allowDeadLetters: true,
    })

    expect(deadLetters).toEqual([])
  })

  it('dead-letters when the result never reaches S3', async () => {
    await receive({
      campaignId,
      status: 'completed',
      s3Key: 'results/missing.json',
    })
    const { deadLetters } = await service.jobs.settle({
      allowDeadLetters: true,
    })

    expect(deadLetters).toEqual([
      expect.objectContaining({
        name: 'campaignPlanComplete',
        error: 'Campaign plan result not found in S3',
      }),
    ])
  })
})

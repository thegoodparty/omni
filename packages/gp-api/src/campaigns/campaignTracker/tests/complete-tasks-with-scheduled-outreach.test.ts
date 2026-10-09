import { useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import {
  CampaignTrackerTask,
  OutreachStatus,
  OutreachType,
} from '../../../generated/prisma'

const service = useTestService()

const BASE_PATH = '/v1/campaigns/tracker-tasks'
const ORG_SLUG = 'campaign-org-scheduled-outreach-test'
const orgHeaders = { headers: { 'x-organization-slug': ORG_SLUG } }

// A campaign with one open plan task, and an outreach launched from it.
const setup = async (status: OutreachStatus) => {
  const org = await service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: 'scheduled-outreach-campaign',
      details: { electionDate: '2099-11-03' },
      organizationSlug: org.slug,
    },
  })
  const task = await service.prisma.campaignTrackerTask.create({
    data: {
      campaignId: campaign.id,
      title: 'Introduction Text',
      description: '',
      week: 0,
      date: new Date('2099-09-08T00:00:00.000Z'),
      phase: 'launch',
      flowType: 'text',
      isDefaultTask: true,
    },
  })
  const outreach = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: org.slug,
      outreachType: OutreachType.text,
      status,
      trackerTaskId: task.id,
    },
  })
  return { task, outreach }
}

const readTask = async (id: string) => {
  const result = await service.client.get<CampaignTrackerTask[]>(
    BASE_PATH,
    orgHeaders,
  )
  expect(result.status).toBe(HttpStatus.OK)
  return result.data.find((row) => row.id === id)
}

describe('Campaign tracker tasks - done once their outreach is scheduled', () => {
  it('marks the task done when its outreach is scheduled', async () => {
    const { task, outreach } = await setup(OutreachStatus.pending)

    expect((await readTask(task.id))?.completed).toBe(true)
    // The link is spent, so it can't tick the task again.
    const after = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreach.id },
    })
    expect(after.trackerTaskId).toBeNull()
  })

  it('marks a set-up task done once its call list or walk exists', async () => {
    // Call lists and door-knocking walks are created in_progress; their task
    // is the setting up, not every call or door.
    const { task } = await setup(OutreachStatus.in_progress)

    expect((await readTask(task.id))?.completed).toBe(true)
  })

  it('leaves the task open while the outreach waits on payment', async () => {
    const { task, outreach } = await setup(OutreachStatus.pending_payment)

    expect((await readTask(task.id))?.completed).toBe(false)
    const after = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreach.id },
    })
    expect(after.trackerTaskId).toBe(task.id)
  })

  it('leaves a draft open', async () => {
    const { task } = await setup(OutreachStatus.draft)

    expect((await readTask(task.id))?.completed).toBe(false)
  })

  it('lets a later Mark not done stick', async () => {
    const { task } = await setup(OutreachStatus.pending)
    expect((await readTask(task.id))?.completed).toBe(true)

    const undone = await service.client.delete(
      `${BASE_PATH}/complete/${task.id}`,
      orgHeaders,
    )
    expect(undone.status).toBe(HttpStatus.OK)

    expect((await readTask(task.id))?.completed).toBe(false)
  })
})

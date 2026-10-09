import { useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { trackerTaskPutOffDate } from '@goodparty_org/contracts'
import { CampaignTrackerTask } from '../../../generated/prisma'

const service = useTestService()

const BASE_PATH = '/v1/campaigns/tracker-tasks'
const ORG_SLUG = 'campaign-org-skip-tracker-task-test'
const orgHeaders = { headers: { 'x-organization-slug': ORG_SLUG } }

const createTask = async ({
  title = 'Plan your launch event',
  date = new Date('2099-10-10'),
}: { title?: string; date?: Date } = {}) => {
  const org = await service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: 'skip-tracker-task-campaign',
      details: {},
      organizationSlug: org.slug,
    },
  })
  return service.prisma.campaignTrackerTask.create({
    data: {
      campaignId: campaign.id,
      title,
      description: 'Pick a date and a place.',
      week: 0,
      date,
      phase: 'launch',
      isDefaultTask: true,
    },
  })
}

describe('Campaign tracker tasks - skip', () => {
  it('moves a task the candidate wants to do later three days out', async () => {
    const task = await createTask()

    const result = await service.client.put<CampaignTrackerTask>(
      `${BASE_PATH}/skip/${task.id}`,
      { reason: 'later' },
      orgHeaders,
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data.skipReason).toBe('later')
    expect(result.data.completed).toBe(false)
    expect(result.data.snoozedUntil).toBeNull()
    expect(new Date(result.data.date as unknown as string)).toEqual(
      trackerTaskPutOffDate(new Date()),
    )
  })

  it('keeps a put-off date when the tracker is read again', async () => {
    const task = await createTask({ title: 'Get your EIN' })
    await service.client.put(
      `${BASE_PATH}/skip/${task.id}`,
      { reason: 'later' },
      orgHeaders,
    )

    const result = await service.client.get<CampaignTrackerTask[]>(
      BASE_PATH,
      orgHeaders,
    )

    const date = result.data.find((row) => row.id === task.id)?.date
    expect(new Date(date as unknown as string)).toEqual(
      trackerTaskPutOffDate(new Date()),
    )
  })

  it('refuses to put off a date that is a fact', async () => {
    const task = await createTask({ title: 'Voter Registration Deadline' })

    const result = await service.client.put(
      `${BASE_PATH}/skip/${task.id}`,
      { reason: 'later' },
      orgHeaders,
    )

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('sets aside a task the candidate never wants, with no snooze', async () => {
    const task = await createTask()

    const result = await service.client.put<CampaignTrackerTask>(
      `${BASE_PATH}/skip/${task.id}`,
      { reason: 'notForMe' },
      orgHeaders,
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data.skipReason).toBe('notForMe')
    expect(result.data.snoozedUntil).toBeNull()
  })

  it('only lets a required task be put off, not set aside for good', async () => {
    const task = await createTask({
      title: 'Submit your Ballot Access Signatures',
    })

    const result = await service.client.put(
      `${BASE_PATH}/skip/${task.id}`,
      { reason: 'notForMe' },
      orgHeaders,
    )

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('undoes a skip', async () => {
    const task = await createTask()
    await service.client.put(
      `${BASE_PATH}/skip/${task.id}`,
      { reason: 'notForMe' },
      orgHeaders,
    )

    const result = await service.client.delete<CampaignTrackerTask>(
      `${BASE_PATH}/skip/${task.id}`,
      orgHeaders,
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data.skipReason).toBeNull()
    expect(result.data.skippedAt).toBeNull()
    expect(result.data.snoozedUntil).toBeNull()
  })

  it('rejects a reason it does not know', async () => {
    const task = await createTask()

    const result = await service.client.put(
      `${BASE_PATH}/skip/${task.id}`,
      { reason: 'someday' },
      orgHeaders,
    )

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('404s a task outside the campaign', async () => {
    await createTask()

    const result = await service.client.put(
      `${BASE_PATH}/skip/not-a-task`,
      { reason: 'later' },
      orgHeaders,
    )

    expect(result.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('lists the skip fields with the tasks', async () => {
    const task = await createTask()
    await service.client.put(
      `${BASE_PATH}/skip/${task.id}`,
      { reason: 'later' },
      orgHeaders,
    )

    const result = await service.client.get<CampaignTrackerTask[]>(
      BASE_PATH,
      orgHeaders,
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data[0]).toMatchObject({ id: task.id, skipReason: 'later' })
  })
})

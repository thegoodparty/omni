import { useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import { differenceInHours } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { TRACKER_TASK_SNOOZE_DAYS } from '@goodparty_org/contracts'
import { CampaignTrackerTask } from '../../../generated/prisma'

const service = useTestService()

const BASE_PATH = '/v1/campaigns/tracker-tasks'
const ORG_SLUG = 'campaign-org-skip-tracker-task-test'
const orgHeaders = { headers: { 'x-organization-slug': ORG_SLUG } }

const createTask = async () => {
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
      title: 'Plan your launch event',
      description: 'Pick a date and a place.',
      week: 0,
      date: new Date('2026-10-10'),
      phase: 'launch',
      isDefaultTask: true,
    },
  })
}

describe('Campaign tracker tasks - skip', () => {
  it('snoozes a task the candidate wants to do later', async () => {
    const task = await createTask()

    const result = await service.client.put<CampaignTrackerTask>(
      `${BASE_PATH}/skip/${task.id}`,
      { reason: 'later' },
      orgHeaders,
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data.skipReason).toBe('later')
    expect(result.data.completed).toBe(false)
    const snoozedUntil = new Date(result.data.snoozedUntil as unknown as string)
    const skippedAt = new Date(result.data.skippedAt as unknown as string)
    expect(differenceInHours(snoozedUntil, skippedAt)).toBe(
      TRACKER_TASK_SNOOZE_DAYS * 24,
    )
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

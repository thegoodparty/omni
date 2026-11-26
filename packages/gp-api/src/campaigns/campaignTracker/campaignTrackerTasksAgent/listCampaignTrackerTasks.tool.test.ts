import { HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { ToolContext } from '@/agents/tools/tool'
import { useTestService } from '@/test-service'
import {
  type CampaignTrackerTask,
  OutreachStatus,
  OutreachType,
} from '../../../generated/prisma'
import { CampaignTrackerTaskResponseSchema } from '../schemas/trackerTaskResponse.schema'
import { CAMPAIGN_STORY_TASK_TITLES } from '../services/staticTrackerTasks.util'
import { listCampaignTrackerTasks } from './listCampaignTrackerTasks.tool'

const service = useTestService()

const BASE_PATH = '/v1/campaigns/tracker-tasks'

// The tool's result is the tracker read's rows, projected through the same
// response schema the endpoint serves them with.
const readTasks = async (organizationSlug: string) =>
  (await listCampaignTrackerTasks.execute(
    {},
    ctx(organizationSlug),
  )) as z.infer<typeof CampaignTrackerTaskResponseSchema>[]

const ctx = (organizationSlug: string): ToolContext => ({
  runId: 'run-1',
  stepKey: '0:listCampaignTrackerTasks:0',
  organizationSlug,
  signal: new AbortController().signal,
  get: (type) => service.app.get(type, { strict: false }),
})

const seedCampaign = async (suffix: string) => {
  const slug = `tracker-tasks-tool-${suffix}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug,
      organizationSlug: slug,
      details: { electionDate: '2099-11-03' },
    },
  })
  const row = (
    data: Partial<CampaignTrackerTask> & { title: string; week: number },
  ) =>
    service.prisma.campaignTrackerTask.create({
      data: {
        campaignId: campaign.id,
        description: '',
        date: new Date('2099-09-08T00:00:00.000Z'),
        phase: 'launch',
        ...data,
      },
    })
  return { slug, campaign, row }
}

describe('listCampaignTrackerTasks tool', () => {
  it('takes no model-supplied identity or campaign', () => {
    expect(Object.keys(listCampaignTrackerTasks.input.shape)).toEqual([])
  })

  it('returns every row the endpoint serves, default and completed included', async () => {
    const { slug, row } = await seedCampaign('results')
    await row({ title: 'Get your EIN', week: 0, isDefaultTask: true })
    await row({ title: 'Introduction Text', week: 0, isDefaultTask: true })
    await row({
      title: 'Set up online donations',
      week: 0,
      isDefaultTask: true,
      completed: true,
    })
    await row({ title: 'Host a house party', week: 1 })

    const tasks = await readTasks(slug)

    const endpoint = await service.client.get<CampaignTrackerTask[]>(
      BASE_PATH,
      { headers: { 'x-organization-slug': slug } },
    )
    expect(endpoint.status).toBe(HttpStatus.OK)
    expect(tasks.map((task) => task.title).sort()).toEqual(
      endpoint.data.map((task) => task.title).sort(),
    )
    expect(tasks).toHaveLength(4)
    // One payload for two readers: the run sees exactly the fields the
    // endpoint publishes, and none of the service's own bookkeeping.
    expect(Object.keys(tasks[0] ?? {}).sort()).toEqual(
      Object.keys(endpoint.data[0] ?? {}).sort(),
    )
    expect(tasks[0]).not.toHaveProperty('sourceRunId')
    expect(
      tasks.find((task) => task.title === 'Host a house party'),
    ).toMatchObject({ isDefaultTask: false, completed: false })
    expect(
      tasks.find((task) => task.title === 'Set up online donations')?.completed,
    ).toBe(true)
  })

  it('ticks a task the candidate finished on another surface, as the read does', async () => {
    const { slug, campaign, row } = await seedCampaign('prior-completion')
    const storyTitle = CAMPAIGN_STORY_TASK_TITLES[0]
    if (!storyTitle) throw new Error('the catalog has no story task')
    const story = await row({
      title: storyTitle,
      week: 0,
      isDefaultTask: true,
    })
    await service.prisma.website.create({
      data: {
        campaignId: campaign.id,
        vanityPath: `${slug}-site`,
        content: {
          about: {
            bio: '<p>Because the ward deserves better.</p>',
            issues: [{ title: 'Housing', description: 'Build more of it' }],
          },
        },
      },
    })
    await service.prisma.campaignStory.create({
      data: { campaignId: campaign.id, background: 'Twenty years here.' },
    })

    const tasks = await readTasks(slug)

    expect(tasks.find((task) => task.id === story.id)?.completed).toBe(true)
    expect(
      await service.prisma.campaignTrackerTask.findUniqueOrThrow({
        where: { id: story.id },
        select: { completed: true },
      }),
    ).toEqual({ completed: true })
  })

  it('ticks a task whose outreach has since been scheduled', async () => {
    const { slug, campaign, row } = await seedCampaign('scheduled-outreach')
    const task = await row({
      title: 'Introduction Text',
      week: 0,
      isDefaultTask: true,
      flowType: 'text',
    })
    await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: slug,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending,
        trackerTaskId: task.id,
      },
    })

    const tasks = await readTasks(slug)

    expect(tasks.find((found) => found.id === task.id)?.completed).toBe(true)
  })

  it('reads only the run organization campaign', async () => {
    const mine = await seedCampaign('mine')
    const other = await seedCampaign('other')
    await mine.row({ title: 'Get your EIN', week: 0, isDefaultTask: true })
    await other.row({ title: 'File your first report', week: 0 })

    const tasks = await readTasks(mine.slug)

    expect(tasks.map((task) => task.title)).toEqual(['Get your EIN'])
    expect(
      await service.prisma.campaignTrackerTask.count({
        where: { campaignId: other.campaign.id, completed: true },
      }),
    ).toBe(0)
  })

  it('returns no tasks for an organization with no campaign', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'tracker-tasks-tool-no-campaign',
        ownerId: service.user.id,
      },
    })

    expect(await readTasks('tracker-tasks-tool-no-campaign')).toEqual([])
  })
})

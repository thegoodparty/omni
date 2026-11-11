import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ExperimentRunStatus, WebsiteStatus } from '@/generated/prisma'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { StrategicLandscapeParamsService } from '@/campaignStrategy/services/strategicLandscapeParams.service'

const service = useTestService({ jobs: true })

const STORY_URL = '/v1/campaigns/mine/story'

let campaignId: number
let headers: { 'x-organization-slug': string }
let seq = 0

const plan = () =>
  service.prisma.campaignStrategy.findUniqueOrThrow({ where: { campaignId } })

beforeEach(async () => {
  const orgSlug = `campaign-story-jobs-${Date.now()}-${seq++}`
  headers = { 'x-organization-slug': orgSlug }
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: orgSlug,
      organizationSlug: orgSlug,
      details: { raceId: 'br-race-1' },
    },
  })
  campaignId = campaign.id
  // Two of the three story answers, the why and a position, live on the
  // website; the background PUT below completes the story.
  await service.prisma.website.create({
    data: {
      campaignId,
      vanityPath: orgSlug,
      status: WebsiteStatus.unpublished,
      content: {
        about: {
          bio: '<p>The ward deserves better</p>',
          issues: [{ title: 'Housing', description: 'Build more of it' }],
        },
      },
    },
  })
  // A plan generated before the candidate wrote a story.
  await service.prisma.campaignStrategy.create({
    data: {
      campaignId,
      raceId: 'br-race-1',
      oppositionPersistedAt: new Date(),
      opportunitiesPersistedAt: new Date(),
    },
  })

  vi.spyOn(
    service.app.get(StrategicLandscapeParamsService),
    'build',
  ).mockResolvedValue({} as never)
})

describe('campaignStoryCompleted', () => {
  it('regenerates a plan built without a story once the story is complete', async () => {
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockImplementation(async ({ type, organizationSlug }) =>
        service.prisma.experimentRun.create({
          data: {
            organizationSlug,
            experimentType: type,
            status: ExperimentRunStatus.RUNNING,
          },
        }),
      )

    const res = await service.client.put(
      STORY_URL,
      { background: 'Ten years organizing tenants' },
      { headers },
    )
    expect(res.status).toBe(200)
    await service.jobs.settle()

    const regenerated = await plan()
    expect(regenerated.generatedWithStory).toBe(true)
    expect(regenerated.storyFingerprint).not.toBeNull()
    expect(regenerated.oppositionPersistedAt).toBeNull()
    expect(regenerated.opportunitiesPersistedAt).toBeNull()
    expect(regenerated.oppositionRunId).not.toBeNull()
    expect(regenerated.opportunitiesRunId).not.toBeNull()
    expect(dispatchRun).toHaveBeenCalledTimes(2)
  })

  it('leaves the plan alone while the story is still incomplete', async () => {
    await service.prisma.website.update({
      where: { campaignId },
      data: { content: { about: { bio: '<p>The ward deserves better</p>' } } },
    })
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    await service.client.put(
      STORY_URL,
      { background: 'Ten years organizing tenants' },
      { headers },
    )
    await service.jobs.settle()

    const untouched = await plan()
    expect(untouched.storyFingerprint).toBeNull()
    expect(untouched.oppositionPersistedAt).not.toBeNull()
    expect(dispatchRun).not.toHaveBeenCalled()
  })
})

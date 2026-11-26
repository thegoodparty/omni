import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { AgentsService } from '@/agents/agents.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { CampaignTrackerTasksService } from '../services/campaignTrackerTasks.service'
import { CampaignTrackerTasksInputSchema } from '../campaignTrackerTasksAgent/campaignTrackerTasks.schema'
import { CAMPAIGN_TRACKER_EXPERIMENT_TYPE } from '../campaignTracker.consts'

// The engine switch for campaign_tracker_tasks, driven through the real app so
// the AgentsService lookup is the production one: a strict `moduleRef.get`
// only searches CampaignsModule, which neither imports AgentsModule nor
// provides AgentsService, so this branch used to throw on every dispatch the
// direct-instantiation suite could not see.
const service = useTestService()

type Seeded = {
  campaignId: number
  organizationSlug: string
}

const seedCampaign = async ({
  ownerEmail,
  testModeCreatedAt = null,
  electionDate = '2099-11-03',
}: {
  ownerEmail: string
  testModeCreatedAt?: Date | null
  electionDate?: string
}): Promise<Seeded> => {
  // An owner of its own: the suite's shared user has a fixed email, and the
  // test-user guard reads the org owner's.
  const owner = await service.prisma.user.create({
    data: {
      email: ownerEmail,
      clerkId: `clerk-${randomUUID()}`,
      firstName: 'Robin',
      lastName: 'Calloway',
    },
  })
  const slug = `tracker-dispatch-${randomUUID()}`
  await service.prisma.organization.create({
    data: {
      slug,
      ownerId: owner.id,
      testModeCreatedAt,
    },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: owner.id,
      slug,
      organizationSlug: slug,
      isActive: true,
      details: {
        raceId: 'br-race-1',
        electionDate,
        state: 'NC',
        city: 'Asheville',
      },
    },
  })
  return { campaignId: campaign.id, organizationSlug: slug }
}

const campaignFor = (seeded: Seeded) =>
  service.prisma.campaign.findFirstOrThrow({
    where: { id: seeded.campaignId },
    include: { user: true },
  })

const stubAgentsRun = () =>
  vi
    .spyOn(service.app.get(AgentsService), 'run')
    .mockResolvedValue({ runId: 'agent-run-1' })

const stubPmfDispatch = () =>
  vi
    .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
    .mockResolvedValue(undefined)

const dispatch = async (seeded: Seeded, mode: 'initial' | 'weekly') =>
  service.app
    .get(CampaignTrackerTasksService)
    .dispatchGeneration(await campaignFor(seeded), mode)

beforeEach(() => {
  vi.stubEnv('AGENTS_ON_GP_API', CAMPAIGN_TRACKER_EXPERIMENT_TYPE)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('campaign_tracker_tasks dispatch engine switch', () => {
  it('dispatches to gp-api’s agent with the camelCase input its schema parses', async () => {
    const seeded = await seedCampaign({ ownerEmail: 'owner@example.com' })
    const run = stubAgentsRun()
    const pmf = stubPmfDispatch()

    await dispatch(seeded, 'initial')

    expect(pmf).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledTimes(1)
    const [name, input] = run.mock.calls[0]!
    expect(name).toBe(CAMPAIGN_TRACKER_EXPERIMENT_TYPE)
    expect(input).toEqual({
      organizationSlug: seeded.organizationSlug,
      raceId: 'br-race-1',
      userFullName: 'Robin Calloway',
      mode: 'initial',
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      electionDate: '2099-11-03',
      state: 'NC',
      city: 'Asheville',
      campaignPlan: null,
      campaignStory: null,
    })
    // The real input check, on the real object: a snake_case key or a date
    // check stricter than the manifest fails here, in the worker, after the
    // run is already created.
    expect(CampaignTrackerTasksInputSchema.safeParse(input).success).toBe(true)
  })

  it('skips the run for a test-user org', async () => {
    const seeded = await seedCampaign({
      ownerEmail: 'someone@test.goodparty.org',
    })
    const run = stubAgentsRun()

    await dispatch(seeded, 'weekly')

    expect(run).not.toHaveBeenCalled()
  })

  it('skips the run for a test-mode org', async () => {
    const seeded = await seedCampaign({
      ownerEmail: 'owner@example.com',
      testModeCreatedAt: new Date('2026-01-05T00:00:00Z'),
    })
    const run = stubAgentsRun()

    await dispatch(seeded, 'weekly')

    expect(run).not.toHaveBeenCalled()
  })

  // The control: with the switch off the same campaign reaches the PMF
  // Engine, so the skips above are the guard and not a dispatch that never
  // would have happened.
  it('dispatches to the PMF Engine when the switch does not name this agent', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    const seeded = await seedCampaign({ ownerEmail: 'owner@example.com' })
    const run = stubAgentsRun()
    const pmf = stubPmfDispatch()

    await dispatch(seeded, 'weekly')

    expect(run).not.toHaveBeenCalled()
    expect(pmf).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: CAMPAIGN_TRACKER_EXPERIMENT_TYPE,
        organizationSlug: seeded.organizationSlug,
        params: expect.objectContaining({ mode: 'weekly' }),
      }),
    )
  })

  // A campaign saved before the election date was normalized carries a
  // datetime (or an empty string) here. The PMF Engine's manifest accepts any
  // string, so the gp-api input has to as well, or the initial generation and
  // every retry is dropped for that campaign.
  it.each(['2099-11-03T00:00:00.000Z', ''])(
    'accepts the legacy election date %j the PMF Engine also accepted',
    async (electionDate) => {
      const seeded = await seedCampaign({
        ownerEmail: 'owner@example.com',
        electionDate,
      })
      const run = stubAgentsRun()

      await dispatch(seeded, 'initial')

      const input = run.mock.calls[0]![1]
      expect(CampaignTrackerTasksInputSchema.safeParse(input).success).toBe(
        true,
      )
      expect(CampaignTrackerTasksInputSchema.parse(input).electionDate).toBe(
        electionDate,
      )
    },
  )
})

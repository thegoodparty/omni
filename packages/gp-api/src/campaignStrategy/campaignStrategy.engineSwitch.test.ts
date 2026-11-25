import { HttpStatus } from '@nestjs/common'
import { subMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import {
  AgentRunStatus,
  ExperimentRunStatus,
  OrganizationRole,
} from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { StrategicLandscapeParamsService } from './services/strategicLandscapeParams.service'

const service = useTestService()

const SLUG = 'engine-switch-org'
const ORG_SLUG_HEADER = 'x-organization-slug'
const PLAN_PATH = '/v1/campaignStrategy/mine/strategic-landscape'
const RACE_ID = 'br-engine-switch'

const spies: { mockRestore: () => void }[] = []
const stub = <T extends { mockRestore: () => void }>(spy: T): T => {
  spies.push(spy)
  return spy
}

const candidate = (firstName: string, lastName: string) => ({
  first_name: firstName,
  last_name: lastName,
  full_name: `${firstName} ${lastName}`,
  email: null,
  website_url: null,
  party: null,
  is_incumbent: false,
})

// The manifest's snake_case params, which is what the params builder emits and
// what the agent's own schema accepts once the keys are converted.
const builtParams = (overrides: Record<string, unknown> = {}) => ({
  race_id: RACE_ID,
  user_email: service.user.email,
  user_first_name: service.user.firstName,
  user_last_name: service.user.lastName,
  user_full_name: 'Johnny Goodparty',
  user_party_affiliation: null,
  other_party: null,
  campaign_strategy_context: {
    candidate_count: 2,
    candidate_office: 'Cheyenne City Council - Ward 1',
    candidates: [candidate('Johnny', 'Goodparty'), candidate('Jane', 'Rival')],
    number_of_seats: 1,
    partisan_type: 'nonpartisan',
    state: 'WY',
    relevant_election_date: '2099-11-03',
  },
  campaign_primary_strategy_context: null,
  // What the params builder emits when the story read fails or the byte budget
  // drops the story: the key is present but undefined.
  campaign_story: undefined,
  ...overrides,
})

// Building params reads the election database, which no suite has.
const stubParams = (value: Record<string, unknown>) =>
  stub(
    vi
      .spyOn(service.app.get(StrategicLandscapeParamsService), 'build')
      .mockResolvedValue(value as never),
  )

const stubPmfDispatch = () =>
  stub(
    vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'oc-run' } as never),
  )

const seedCampaign = async (overrides: Record<string, unknown> = {}) => {
  await service.prisma.organization.create({
    data: { slug: SLUG, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      organizationSlug: SLUG,
      userId: service.user.id,
      slug: SLUG,
      isPro: true,
      details: { raceId: RACE_ID, electionDate: '2099-11-03' },
      ...overrides,
    },
  })
}

const seedPlan = (
  campaignId: number,
  overrides: Record<string, unknown> = {},
) =>
  service.prisma.campaignStrategy.create({
    data: { campaignId, raceId: RACE_ID, ...overrides },
  })

const planOf = (campaignId: number) =>
  service.prisma.campaignStrategy.findFirstOrThrow({ where: { campaignId } })

const poll = () =>
  service.client.post(PLAN_PATH, {}, { headers: { [ORG_SLUG_HEADER]: SLUG } })

beforeEach(() => {
  stub(
    vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue({ event: 'stub', userId: 'stub' }),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  spies.splice(0).forEach((spy) => spy.mockRestore())
})

// The engine switch is per agent, so one request can dispatch its two sections
// to different engines. The opposition section's input is the manifest's params
// converted to gp-api's camelCase.
describe('POST /v1/campaignStrategy/mine/strategic-landscape, engine switch', () => {
  it('dispatches the switched-on section to gp-api’s agent and the other to the PMF Engine', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'opposition_research')
    const campaign = await seedCampaign()
    stubParams(builtParams())
    const pmf = stubPmfDispatch()

    const res = await poll()

    expect(res.status).toBe(HttpStatus.ACCEPTED)
    expect(res.data).toEqual({ status: 'generating' })

    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: SLUG, agentName: 'opposition_research' },
    })
    expect(run.status).toBe(AgentRunStatus.queued)
    expect(run.input).toMatchObject({
      organizationSlug: SLUG,
      raceId: RACE_ID,
      userEmail: service.user.email,
      userFullName: 'Johnny Goodparty',
      campaignStrategyContext: {
        candidateCount: 2,
        candidateOffice: 'Cheyenne City Council - Ward 1',
      },
    })
    expect((await planOf(campaign.id)).oppositionRunId).toBe(run.id)

    expect(pmf).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: 'opportunities_and_challenges' }),
    )
    expect(
      await service.prisma.experimentRun.count({
        where: { organizationSlug: SLUG },
      }),
    ).toBe(0)
  })

  // opportunities_and_challenges is the one agent whose input carries the run's
  // date: the PMF Engine's runner stated it in the system prompt, and the runway
  // to the election is counted from it. The dispatcher fills it, or the agent's
  // own input check refuses the run.
  it('dispatches the switched-on opportunities section with the run’s date', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'opportunities_and_challenges')
    const campaign = await seedCampaign()
    stubParams(builtParams())
    const pmf = stubPmfDispatch()

    const res = await poll()

    expect(res.data).toEqual({ status: 'generating' })
    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: {
        organizationSlug: SLUG,
        agentName: 'opportunities_and_challenges',
      },
    })
    expect(run.input).toMatchObject({
      organizationSlug: SLUG,
      raceId: RACE_ID,
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown as string,
    })
    expect((await planOf(campaign.id)).opportunitiesRunId).toBe(run.id)
    // The opposition section still went to the PMF Engine on this run.
    expect(pmf).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: 'opposition_research' }),
    )
  })

  // The params builder leaves an optional field out by setting it to undefined,
  // and the agent's schema declares it optional but not nullable. Writing null
  // for it failed every dispatch whose story read failed or whose story the byte
  // budget dropped.
  it('dispatches with no campaign story instead of failing the agent’s input check', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'opposition_research')
    await seedCampaign()
    stubParams(builtParams())
    stubPmfDispatch()

    const res = await poll()

    expect(res.data).toEqual({ status: 'generating' })
    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: SLUG, agentName: 'opposition_research' },
    })
    expect(run.input).not.toHaveProperty('campaignStory')
  })

  // gp-api's dispatch makes the same synthetic-org check the PMF Engine's
  // dispatchRun does, so a test org spends no paid run on either engine. The
  // requesting user is a real one here; the org's owner is the test user.
  it('spends no agent run for an org whose owner is a test user', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'opposition_research')
    const owner = await service.prisma.user.create({
      data: {
        clerkId: 'clerk-test-owner',
        email: 'someone@test.goodparty.org',
      },
    })
    await service.prisma.organization.create({
      data: { slug: SLUG, ownerId: owner.id },
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: SLUG,
        userId: service.user.id,
        role: OrganizationRole.campaignAdmin,
      },
    })
    await service.prisma.campaign.create({
      data: {
        organizationSlug: SLUG,
        userId: service.user.id,
        slug: SLUG,
        isPro: true,
        details: { raceId: RACE_ID, electionDate: '2099-11-03' },
      },
    })
    stubParams(builtParams())
    stubPmfDispatch()

    await poll()

    expect(
      await service.prisma.agentRun.count({
        where: { organizationSlug: SLUG },
      }),
    ).toBe(0)
  })

  // gp-api's supersede starts a successor under a NEW run id that nothing points
  // the plan at, so the run the plan still names can never land. Reading that as
  // in flight (right for the PMF Engine's shared-link successor) hangs the plan
  // generating forever.
  it('re-dispatches when the plan names a superseded gp-api run', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'opposition_research')
    const campaign = await seedCampaign()
    const stale = await service.prisma.agentRun.create({
      data: {
        agentName: 'opposition_research',
        organizationSlug: SLUG,
        status: AgentRunStatus.superseded,
        manifest: {},
        shapeHash: 'a-shape-hash',
        input: {},
      },
    })
    await seedPlan(campaign.id, { oppositionRunId: stale.id })
    stubParams(builtParams())
    stubPmfDispatch()

    const res = await poll()

    expect(res.data).toEqual({ status: 'generating' })
    expect((await planOf(campaign.id)).oppositionRunId).not.toBe(stale.id)
    expect(
      await service.prisma.agentRun.count({
        where: {
          organizationSlug: SLUG,
          agentName: 'opposition_research',
          status: AgentRunStatus.queued,
        },
      }),
    ).toBe(1)
  })

  // A section dispatched before the switch flipped keeps its run id in the
  // other engine's table. Reading only the switched-to table saw no run, called
  // the section idle and started a second paid run whose predecessor landed
  // nowhere the plan points at. The id is in exactly one table, so the run that
  // answers is whichever holds it.
  it('reads the PMF Engine section run the plan still names after the switch flips', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'opposition_research')
    const campaign = await seedCampaign()
    const inflight = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: SLUG,
        experimentType: 'opposition_research',
        status: ExperimentRunStatus.RUNNING,
      },
    })
    await seedPlan(campaign.id, { oppositionRunId: inflight.runId })
    stubParams(builtParams())
    stubPmfDispatch()

    const res = await poll()

    expect(res.data).toEqual({ status: 'generating' })
    expect((await planOf(campaign.id)).oppositionRunId).toBe(inflight.runId)
    expect(
      await service.prisma.agentRun.count({
        where: { organizationSlug: SLUG, agentName: 'opposition_research' },
      }),
    ).toBe(0)
  })

  // The same gap in reverse: a gp-api run in flight when the switch flips back
  // keeps its run id in `AgentRun`, so the PMF-table-first read has to fall back.
  it('reads the gp-api section run the plan still names after the switch flips back', async () => {
    const campaign = await seedCampaign()
    const inflight = await service.prisma.agentRun.create({
      data: {
        agentName: 'opposition_research',
        organizationSlug: SLUG,
        status: AgentRunStatus.running,
        manifest: {},
        shapeHash: 'a-shape-hash',
        input: {},
      },
    })
    await seedPlan(campaign.id, { oppositionRunId: inflight.id })
    stubParams(builtParams())
    const pmf = stubPmfDispatch()

    const res = await poll()

    expect(res.data).toEqual({ status: 'generating' })
    expect((await planOf(campaign.id)).oppositionRunId).toBe(inflight.id)
    expect(pmf).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'opposition_research' }),
    )
  })
})

// The bootstrap is the one step after a section's last persist that can fail
// without failing the run, so the ready poll is the only path that retries it:
// the bootstrap claims trackerBootstrapped atomically, which makes a repeat a
// no-op.
describe('POST /v1/campaignStrategy/mine/strategic-landscape, tracker bootstrap', () => {
  it('re-attempts the tracker bootstrap on a ready poll', async () => {
    const campaign = await seedCampaign()
    await seedPlan(campaign.id, {
      oppositionPersistedAt: new Date(),
      opportunitiesPersistedAt: new Date(),
    })

    const res = await poll()

    expect(res.data.status).toBe('ready')
    expect((await planOf(campaign.id)).trackerBootstrapped).toBe(true)
  })

  // `tracker_bootstrapped` shipped DEFAULT false with no backfill, so every plan
  // that went ready before that column existed reads false. An unscoped retry
  // would start a paid initial tracker generation for each of them on its next
  // page load; only a section persisted inside the grace window can be one whose
  // bootstrap just failed.
  it('leaves a plan alone whose sections persisted outside the grace window', async () => {
    const campaign = await seedCampaign()
    const old = subMinutes(new Date(), 30)
    await seedPlan(campaign.id, {
      oppositionPersistedAt: old,
      opportunitiesPersistedAt: old,
    })

    const res = await poll()

    expect(res.data.status).toBe('ready')
    expect((await planOf(campaign.id)).trackerBootstrapped).toBe(false)
  })
})

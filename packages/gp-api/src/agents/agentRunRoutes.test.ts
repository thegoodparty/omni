import {
  GetQueueUrlCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs'
import { HttpStatus } from '@nestjs/common'
import { mockClient } from 'aws-sdk-client-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentRunStatus, ExperimentRunStatus } from '@/generated/prisma'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { useTestService } from '@/test-service'

// The judge's run routes: one door into any background agent, on whichever
// engine runs it. Every test drives them over HTTP, as the judge does.

const service = useTestService()

const sqsMock = mockClient(SQSClient)
const QUEUE_URL = 'https://sqs.us-west-2.amazonaws.com/1/agent-dispatch.fifo'

const ORG_SLUG = 'judge-run-route-org'

// A suite writes one input per case, in the shape every agent has: its
// manifest's, whose fields are snake_case. Both arms below are driven by this
// same object, which is the point of the route.
const TRENDING_INPUT = {
  organization_slug: ORG_SLUG,
  state: 'NC',
  office: 'City Council Member',
  district_descriptor: 'FAYETTEVILLE CITY WARD 2, NC',
}

const startRun = (name: string, input: Record<string, unknown>) =>
  service.client.post<{ runId: string }>(`/v1/agents/${name}/runs`, { input })

const readRun = (runId: string) =>
  service.client.get<{
    status: string
    artifact: unknown
    error: string | null
  }>(`/v1/agents/runs/${runId}`)

const seedOrg = async (ownerId = service.user.id, slug = ORG_SLUG) => {
  await service.prisma.organization.create({ data: { slug, ownerId } })
  return slug
}

beforeEach(async () => {
  sqsMock.reset()
  sqsMock.on(GetQueueUrlCommand).resolves({ QueueUrl: QUEUE_URL })
  sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' })
  vi.stubEnv('AGENT_DISPATCH_QUEUE_NAME', 'agent-dispatch.fifo')
  await seedOrg()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the deploy gate', () => {
  it('refuses both routes on prod, as if they were not there', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')

    expect((await startRun('trending_issues', TRENDING_INPUT)).status).toBe(
      HttpStatus.NOT_FOUND,
    )
    expect((await readRun('any-run-id')).status).toBe(HttpStatus.NOT_FOUND)
  })

  it('refuses both routes on qa', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'qa')

    expect((await startRun('trending_issues', TRENDING_INPUT)).status).toBe(
      HttpStatus.NOT_FOUND,
    )
    expect((await readRun('any-run-id')).status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('membership', () => {
  it('refuses an org the caller does not belong to, and starts nothing', async () => {
    const other = await service.prisma.user.create({
      data: { clerkId: 'user_other', email: 'other@goodparty.org' },
    })
    await seedOrg(other.id, 'someone-elses-org')

    const res = await startRun('trending_issues', {
      ...TRENDING_INPUT,
      organization_slug: 'someone-elses-org',
    })

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(await service.prisma.agentRun.count()).toBe(0)
    expect(await service.prisma.experimentRun.count()).toBe(0)
  })

  it('refuses a run whose org the caller does not belong to', async () => {
    const other = await service.prisma.user.create({
      data: { clerkId: 'user_other', email: 'other@goodparty.org' },
    })
    await seedOrg(other.id, 'someone-elses-org')
    const run = await service.prisma.experimentRun.create({
      data: {
        experimentType: 'trending_issues',
        organizationSlug: 'someone-elses-org',
        status: ExperimentRunStatus.COMPLETED,
      },
    })

    expect((await readRun(run.runId)).status).toBe(HttpStatus.NOT_FOUND)
  })

  it('refuses an input that names no org', async () => {
    expect((await startRun('trending_issues', { state: 'NC' })).status).toBe(
      HttpStatus.BAD_REQUEST,
    )
  })
})

describe('compliance_setup', () => {
  it('is refused by name: it makes real purchases', async () => {
    const res = await startRun('compliance_setup', {
      organization_slug: ORG_SLUG,
      campaign_id: 1,
      candidate_last_name: 'Smith',
      clerk_user_id: 'user_x',
      election_date: '2027-11-02',
      trigger: 'initial',
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(
      await service.prisma.experimentRun.count({
        where: { experimentType: 'compliance_setup' },
      }),
    ).toBe(0)
  })
})

describe('on gp-api', () => {
  beforeEach(() => {
    vi.stubEnv('AGENTS_ON_GP_API', 'trending_issues')
  })

  it('starts an AgentRun from the same snake_case input the PMF Engine takes', async () => {
    const res = await startRun('trending_issues', TRENDING_INPUT)

    expect(res.status).toBe(HttpStatus.CREATED)
    const run = await service.prisma.agentRun.findUniqueOrThrow({
      where: { id: res.data.runId },
    })
    expect(run.agentName).toBe('trending_issues')
    expect(run.organizationSlug).toBe(ORG_SLUG)
    expect(run.status).toBe(AgentRunStatus.queued)
    expect(run.input).toEqual({
      organizationSlug: ORG_SLUG,
      state: 'NC',
      office: 'City Council Member',
      districtDescriptor: 'FAYETTEVILLE CITY WARD 2, NC',
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown as string,
    })
    expect(await service.prisma.experimentRun.count()).toBe(0)
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0)
  })

  it('keeps a today the suite supplied rather than overwriting it', async () => {
    const res = await startRun('trending_issues', {
      ...TRENDING_INPUT,
      today: '2026-11-19',
    })

    const run = await service.prisma.agentRun.findUniqueOrThrow({
      where: { id: res.data.runId },
    })
    expect(run.input).toMatchObject({ today: '2026-11-19' })
  })

  it('reads the artifact off the run once it has one', async () => {
    const run = await service.prisma.agentRun.create({
      data: {
        agentName: 'trending_issues',
        organizationSlug: ORG_SLUG,
        status: AgentRunStatus.completed,
        manifest: {},
        shapeHash: 'a-shape',
        input: { organizationSlug: ORG_SLUG },
        artifact: { list: 'trending', issues: [] },
      },
    })

    const res = await readRun(run.id)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      status: 'completed',
      artifact: { list: 'trending', issues: [] },
      error: null,
    })
  })

  it('reports a failed run with its error', async () => {
    const run = await service.prisma.agentRun.create({
      data: {
        agentName: 'trending_issues',
        organizationSlug: ORG_SLUG,
        status: AgentRunStatus.failed,
        manifest: {},
        shapeHash: 'a-shape',
        input: { organizationSlug: ORG_SLUG },
        error: 'the model ran out of steps',
      },
    })

    const res = await readRun(run.id)

    expect(res.data).toEqual({
      status: 'failed',
      artifact: null,
      error: 'the model ran out of steps',
    })
  })
})

describe('on the PMF Engine', () => {
  beforeEach(async () => {
    // Every judge run brings a new test user, and the product's own dispatch
    // guard refuses those. This route is the one caller that dispatches as one.
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'judge-abc123@test.goodparty.org' },
    })
  })

  it('dispatches the same input through the experiment path', async () => {
    const res = await startRun('trending_issues', TRENDING_INPUT)

    expect(res.status).toBe(HttpStatus.CREATED)
    const run = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: res.data.runId },
    })
    expect(run.experimentType).toBe('trending_issues')
    expect(run.organizationSlug).toBe(ORG_SLUG)
    expect(run.status).toBe(ExperimentRunStatus.QUEUED)
    expect(run.params).toEqual(TRENDING_INPUT)
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1)
    expect(await service.prisma.agentRun.count()).toBe(0)
  })

  it('reads the artifact the run published to S3', async () => {
    const run = await service.prisma.experimentRun.create({
      data: {
        experimentType: 'trending_issues',
        organizationSlug: ORG_SLUG,
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'agent-results',
        artifactKey: 'trending_issues/a-run/output.json',
      },
    })
    vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(
      JSON.stringify({ list: 'trending', issues: [] }),
    )

    const res = await readRun(run.runId)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      status: 'completed',
      artifact: { list: 'trending', issues: [] },
      error: null,
    })
  })

  it('reports a run still waiting on its own recovery loop as running', async () => {
    const run = await service.prisma.experimentRun.create({
      data: {
        experimentType: 'find_existing_ordinances',
        organizationSlug: ORG_SLUG,
        status: ExperimentRunStatus.AWAITING_RESUME,
      },
    })

    expect((await readRun(run.runId)).data.status).toBe('running')
  })

  it('reports a run with no artifact published yet as null', async () => {
    const res = await startRun('trending_issues', TRENDING_INPUT)

    expect((await readRun(res.data.runId)).data).toEqual({
      status: 'queued',
      artifact: null,
      error: null,
    })
  })
})

describe('the product dispatchers', () => {
  it('still skip a test-user org', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'judge-abc123@test.goodparty.org' },
    })

    const dispatched = await service.app
      .get(ExperimentRunsService)
      .dispatchRun({
        type: 'find_existing_ordinances',
        organizationSlug: ORG_SLUG,
        clerkUserId: 'user_x',
        params: {
          organization_slug: ORG_SLUG,
          state: 'NC',
          office: 'City Council Member',
        },
      })

    expect(dispatched).toBeUndefined()
    expect(await service.prisma.experimentRun.count()).toBe(0)
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0)
  })
})

describe('an unknown run', () => {
  it('is a 404', async () => {
    expect((await readRun('0191f0d0-0000-7000-8000-000000000000')).status).toBe(
      HttpStatus.NOT_FOUND,
    )
  })
})

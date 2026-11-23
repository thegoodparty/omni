import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider'
import { HttpStatus } from '@nestjs/common'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { v7 as uuidv7 } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { AgentModels } from '@/agents/agentModels'
import { AGENTS } from '@/agents/agents.registry'
import { AgentWebService } from '@/agents/tools/agentWeb.service'
import {
  AgentRunStatus,
  type ElectedOffice,
  ExperimentRunStatus,
  MeetingResourceLocationType,
} from '@/generated/prisma'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { useTestService } from '@/test-service'
import { MeetingBriefingsService } from '../services/meetingBriefings.service'
import { MeetingScheduleInputSchema } from './meetingSchedule.schema'

const service = useTestService({ jobs: true })

const BASE = '/v1/meetings/briefings/dispatch'

let orgSlug: string
let electedOffice: ElectedOffice
// Restored one by one: restoreAllMocks would also undo the test service's own
// session-token mock.
const spies: { mockRestore: () => void }[] = []

const AGENDAS_URL = 'https://www.burnsvillemn.gov/agendas'

const FOUND = {
  generated_at: '2026-11-23T00:00:00Z',
  status: 'found',
  meeting_name: 'City Council',
  location: 'City Hall Council Chambers, 200 Main St',
  rrule: 'FREQ=MONTHLY;BYDAY=2MO,4MO',
  human: 'Second and fourth Monday of every month',
  time: '23:59',
  timezone: 'America/Chicago',
  duration_minutes: 120,
  sources: [
    {
      url: AGENDAS_URL,
      note: 'The agendas page states the 2nd and 4th Monday at 7 PM.',
    },
  ],
  discovered_schedule_location: AGENDAS_URL,
}

const toolCall = (toolName: string, input: unknown) => ({
  type: 'tool-call' as const,
  toolCallId: `call-${uuidv7()}`,
  toolName,
  input: JSON.stringify(input),
})

// The run's steps, picked by how many assistant turns are already in the
// prompt: fetch the official agendas page, then submit what it said.
const scriptedModel = (output: unknown = FOUND) => {
  const prompts: string[] = []
  const reply = (options: LanguageModelV3CallOptions) => {
    prompts.push(JSON.stringify(options.prompt))
    const step = options.prompt.filter((m) => m.role === 'assistant').length
    if (step === 0) return toolCall('fetchPage', { url: AGENDAS_URL })
    return toolCall('submitOutput', { output })
  }
  const model = new MockLanguageModelV3({
    doStream: async (options) => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: 'stream-start', warnings: [] },
          reply(options),
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: 'tool_use' },
            usage: {
              inputTokens: {
                total: 2000,
                noCache: 2000,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 200, text: 200, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  })
  spies.push(
    vi.spyOn(service.app.get(AgentModels), 'resolve').mockReturnValue({
      model,
      modelId: 'claude-sonnet-4-6',
      provider: 'anthropic',
    }),
  )
  return prompts
}

const dispatchSchedule = () =>
  service.client.post<{ dispatched: boolean }>(BASE, {
    electedOfficeId: electedOffice.id,
    kind: 'schedule',
  })

beforeEach(async () => {
  orgSlug = `eo-meeting-schedule-${uuidv7()}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  electedOffice = await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: orgSlug },
  })
  spies.push(
    vi
      .spyOn(service.app.get(OrganizationsService), 'resolveServeContext')
      .mockResolvedValue({
        state: 'MN',
        positionName: 'Burnsville City Council Member',
      }),
    // fetchPage reads through the guard on every call; a stand-in page keeps
    // the test off the network.
    vi.spyOn(service.app.get(AgentWebService), 'request').mockResolvedValue({
      status: 200,
      contentType: 'text/html',
      body: Buffer.from('<html><body>2nd and 4th Monday</body></html>'),
    }),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  spies.splice(0).forEach((spy) => spy.mockRestore())
})

describe('meeting_schedule on gp-api agents', () => {
  it('runs on gp-api when switched on and persists the hint it found', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    const pmfDispatch = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )
    spies.push(pmfDispatch)
    scriptedModel()

    const res = await dispatchSchedule()
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ dispatched: true, kind: 'schedule' })
    await service.jobs.settle()

    expect(pmfDispatch).not.toHaveBeenCalled()
    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: orgSlug, agentName: 'meeting_schedule' },
    })
    expect(run.status).toBe(AgentRunStatus.completed)
    expect(run.input).toMatchObject({
      organizationSlug: orgSlug,
      state: 'MN',
      office: 'Burnsville City Council Member',
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })

    const hint = await service.prisma.meetingResourceLocation.findUnique({
      where: {
        electedOfficeId_type: {
          electedOfficeId: electedOffice.id,
          type: MeetingResourceLocationType.SCHEDULE,
        },
      },
    })
    expect(hint?.description).toBe(FOUND.discovered_schedule_location)
  })

  // A hint can already point at a PMF Engine run, written before the switch
  // flipped. The gp-api run rewrites the description, and the stale pointer
  // would credit the schedule it replaced.
  it('clears the PMF run pointer when an AgentRun writes over its hint', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    const pmfRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'schedule-bucket',
        artifactKey: 'schedule.json',
        params: { elected_office_id: electedOffice.id },
      },
    })
    await service.prisma.meetingResourceLocation.create({
      data: {
        electedOfficeId: electedOffice.id,
        type: MeetingResourceLocationType.SCHEDULE,
        description: 'https://www.burnsvillemn.gov/old-schedule',
        experimentRunId: pmfRun.runId,
      },
    })
    scriptedModel()

    await dispatchSchedule()
    await service.jobs.settle()

    const hint = await service.prisma.meetingResourceLocation.findUniqueOrThrow(
      {
        where: {
          electedOfficeId_type: {
            electedOfficeId: electedOffice.id,
            type: MeetingResourceLocationType.SCHEDULE,
          },
        },
      },
    )
    expect(hint.description).toBe(FOUND.discovered_schedule_location)
    expect(hint.experimentRunId).toBeNull()
  })

  it('reads the schedule back from the AgentRun when that engine holds it', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    scriptedModel()
    await dispatchSchedule()
    await service.jobs.settle()

    const schedule = await service.app
      .get(MeetingBriefingsService)
      .loadLatestScheduleForOrg(orgSlug)

    expect(schedule).toEqual(FOUND)
  })

  it('feeds a hint the previous run left into the next run, in gp-api names', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    await service.prisma.meetingResourceLocation.create({
      data: {
        electedOfficeId: electedOffice.id,
        type: MeetingResourceLocationType.SCHEDULE,
        description: 'https://www.burnsvillemn.gov/2041/Government-Operations',
      },
    })
    const prompts = scriptedModel()

    await dispatchSchedule()
    await service.jobs.settle()

    expect(prompts[0]).toContain(
      'https://www.burnsvillemn.gov/2041/Government-Operations',
    )
  })

  // onArtifact can run twice for one run (a crash before the run is marked
  // complete). Writing the hint twice is an upsert, and the second write is a
  // no-op with the same description.
  it('writes the same hint again when onArtifact runs twice', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    scriptedModel()
    await dispatchSchedule()
    await service.jobs.settle()
    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: orgSlug, agentName: 'meeting_schedule' },
    })

    await AGENTS.meeting_schedule?.onArtifact(
      FOUND,
      { runId: run.id, input: MeetingScheduleInputSchema.parse(run.input) },
      { get: (type) => service.app.get(type, { strict: false }) },
    )

    expect(
      await service.prisma.meetingResourceLocation.count({
        where: { electedOfficeId: electedOffice.id },
      }),
    ).toBe(1)
  })

  it('chains a briefing after a schedule lands for an onboarded office', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
    await service.prisma.electedOffice.update({
      where: { id: electedOffice.id },
      data: { onboardingCompletedAt: new Date() },
    })
    const briefingDispatch = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)
    spies.push(briefingDispatch)
    // Daily, so a meeting always falls inside the 3-day imminence window
    // whatever day the suite runs.
    scriptedModel({ ...FOUND, rrule: 'FREQ=DAILY', human: 'Every day' })

    await dispatchSchedule()
    await service.jobs.settle()

    expect(briefingDispatch.mock.calls.map((call) => call[0].type)).toEqual([
      'meeting_briefing',
    ])
  })

  it('chains no briefing for an office still in onboarding', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
    const briefingDispatch = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)
    spies.push(briefingDispatch)
    // Daily too, so the gate this case exercises is the onboarding one and not
    // an empty imminence window that would pass on most days for the wrong
    // reason.
    scriptedModel({ ...FOUND, rrule: 'FREQ=DAILY', human: 'Every day' })

    await dispatchSchedule()
    await service.jobs.settle()

    expect(briefingDispatch).not.toHaveBeenCalled()
  })

  it('dispatches to the PMF Engine when the switch is off', async () => {
    const pmfDispatch = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)
    spies.push(pmfDispatch)

    await dispatchSchedule()

    expect(pmfDispatch).toHaveBeenCalledWith({
      type: 'meeting_schedule',
      organizationSlug: orgSlug,
      clerkUserId: service.user.clerkId,
      priority: 'HIGH',
      params: {
        elected_office_id: electedOffice.id,
        state: 'MN',
        office: 'Burnsville City Council Member',
      },
    })
    expect(
      await service.prisma.agentRun.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(0)
  })

  it('started no run the second time a schedule already exists for the org', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    // Automation on, so the duplicate-run guard is the only thing between this
    // hook and a second run.
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
    await service.prisma.agentRun.create({
      data: {
        agentName: 'meeting_schedule',
        organizationSlug: orgSlug,
        status: AgentRunStatus.completed,
        manifest: {},
        shapeHash: 'a-shape',
        input: { organizationSlug: orgSlug },
      },
    })

    await service.app
      .get(MeetingBriefingsService)
      .onElectedOfficeCreated(electedOffice)

    expect(
      await service.prisma.agentRun.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(1)
  })

  it('starts no run for an organization in test mode', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    await service.prisma.organization.update({
      where: { slug: orgSlug },
      data: { testModeCreatedAt: new Date() },
    })

    await dispatchSchedule()

    expect(
      await service.prisma.agentRun.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(0)
  })

  it('takes a not_found run as an answer, with no hint to persist', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    scriptedModel({
      generated_at: '2026-11-23T00:00:00Z',
      status: 'not_found',
      meeting_name: '',
      location: '',
      rrule: '',
      human: '',
      time: '',
      timezone: '',
      duration_minutes: 0,
      sources: [
        {
          url: 'https://www.burnsvillemn.gov/agendas',
          note: 'The page lists dates but states no recurrence.',
        },
      ],
      discovered_schedule_location: null,
    })

    await dispatchSchedule()
    await service.jobs.settle()

    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: orgSlug, agentName: 'meeting_schedule' },
    })
    expect(run.status).toBe(AgentRunStatus.completed)
    expect(
      await service.prisma.meetingResourceLocation.count({
        where: { electedOfficeId: electedOffice.id },
      }),
    ).toBe(0)
  })
})

describe('the schedule readers before gp-api holds the run', () => {
  it('falls back to the published schedule for an office with no AgentRun yet', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    const artifactKey = `published-${orgSlug}.json`
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'schedule-bucket',
        artifactKey,
      },
    })
    spies.push(
      vi
        .spyOn(service.app.get(S3Service), 'getFile')
        .mockResolvedValue(JSON.stringify(FOUND)),
    )

    const schedule = await service.app
      .get(MeetingBriefingsService)
      .loadLatestScheduleForOrg(orgSlug)

    expect(schedule).toEqual(FOUND)
  })

  it('prefers the AgentRun once the office has a completed run of its own', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'meeting_schedule')
    const earlier = { ...FOUND, meeting_name: 'Village Board' }
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'schedule-bucket',
        artifactKey: `published-${orgSlug}.json`,
      },
    })
    const getFile = vi
      .spyOn(service.app.get(S3Service), 'getFile')
      .mockResolvedValue(JSON.stringify(earlier))
    spies.push(getFile)
    scriptedModel()

    await dispatchSchedule()
    await service.jobs.settle()

    const schedule = await service.app
      .get(MeetingBriefingsService)
      .loadLatestScheduleForOrg(orgSlug)

    expect(schedule?.meeting_name).toBe(FOUND.meeting_name)
    expect(getFile).not.toHaveBeenCalled()
  })

  it('reads the published artifact when the switch is off', async () => {
    const artifactKey = `schedule-${orgSlug}.json`
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'schedule-bucket',
        artifactKey,
      },
    })
    spies.push(
      vi
        .spyOn(service.app.get(S3Service), 'getFile')
        .mockResolvedValue(JSON.stringify(FOUND)),
    )

    const schedule = await service.app
      .get(MeetingBriefingsService)
      .loadLatestScheduleForOrg(orgSlug)

    expect(schedule).toEqual(FOUND)
  })
})

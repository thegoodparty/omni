import type {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
} from '@ai-sdk/provider'
import { MockLanguageModelV3 } from 'ai/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentRunStatus, ChatScope } from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { useTestService } from '@/test-service'
import { AgentsService } from '../agents.service'
import { AGENTS } from '../agents.registry'
import { placeholder } from '../meetingBriefing/meetingBriefingArtifact.fixture'
import { AgentModels } from './agentModels'
import { agentShapeHash } from './shapeHash'

const service = useTestService({ jobs: true })

const STAGE_MARKERS = {
  findAgenda: 'stage 1 of 3',
  readPacket: 'stage 2 of 3',
  writeBriefing: 'stage 3 of 3',
} as const
type StageName = keyof typeof STAGE_MARKERS

const agenda = (found: boolean) => ({
  found,
  briefing_status: found ? 'agenda_found' : 'awaiting_agenda',
  derived_city: 'Hendersonville',
  meeting_name: 'City Council',
  location: '',
  meeting_time: '',
  meeting_timezone: '',
  agenda_packet_url: null,
  discovered_agenda_location: null,
  agenda_availability: found ? 'full_packet' : 'not_published',
  documents: [],
  agenda_items: [],
  sources: [],
  run_decisions: [],
})

const packetNotes = {
  substantive_items_found: false,
  triage_source: 'priorities',
  packet_stated_meeting_date: null,
  packet_date_verification: 'unavailable',
  items: [],
  sources: [],
  run_decisions: [],
}

const toolCall = (
  toolName: string,
  input: unknown,
): LanguageModelV3GenerateResult => ({
  content: [
    {
      type: 'tool-call',
      toolCallId: `call-${Math.random().toString(36).slice(2)}`,
      toolName,
      input: JSON.stringify(input),
    },
  ],
  finishReason: { unified: 'tool-calls', raw: 'tool_use' },
  usage: {
    inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 100, text: 100, reasoning: undefined },
  },
  warnings: [],
})

// A scripted model: which stage it is in comes from the stage prompt, which
// step from the assistant turns already in the prompt.
const scriptedModel = (script: {
  found: boolean
  failReadPacketStepOnce?: number
}) => {
  const calls: string[] = []
  let failOnce = script.failReadPacketStepOnce
  const model = new MockLanguageModelV3({
    doGenerate: async (options: LanguageModelV3CallOptions) => {
      const system = options.prompt.find((m) => m.role === 'system')
      const stage = (Object.keys(STAGE_MARKERS) as StageName[]).find(
        (name) =>
          typeof system?.content === 'string' &&
          system.content.includes(STAGE_MARKERS[name]),
      )
      const step = options.prompt.filter((m) => m.role === 'assistant').length
      calls.push(`${stage}:${step}`)
      if (stage === 'findAgenda') {
        return toolCall('submitOutput', { output: agenda(script.found) })
      }
      if (stage === 'readPacket') {
        if (step === failOnce) {
          failOnce = undefined
          throw new Error('the worker died mid-stage')
        }
        return step < 2
          ? toolCall('officialPriorities', {})
          : toolCall('submitOutput', { output: packetNotes })
      }
      return toolCall('submitOutput', { output: placeholder })
    },
  })
  vi.spyOn(service.app.get(AgentModels), 'languageModel').mockReturnValue(model)
  return calls
}

const seedInput = async (slug: string) => {
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const office = await service.prisma.electedOffice.create({
    data: { organizationSlug: slug, userId: service.user.id },
  })
  return {
    organizationSlug: slug,
    electedOfficeId: office.id,
    requestedAt: '2026-05-14T12:00:00Z',
    officialName: 'Rowan Ledbetter',
    state: 'NC',
    meetingDate: '2026-05-19',
  }
}

describe('AI SDK agent runtime', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('runs every stage as a pg-boss job and saves the artifact', async () => {
    const calls = scriptedModel({ found: true })
    const input = await seedInput('eo-ai-sdk-run')
    const agents = service.app.get(AgentsService)

    const { runId } = await agents.run('meetingBriefing', input)
    await service.jobs.settle()

    const view = await agents.getRun(runId)
    expect(view).toMatchObject({
      agent: 'meetingBriefing',
      status: 'completed',
      shapeHash: agentShapeHash(AGENTS.meetingBriefing.stages),
      stages: [
        { name: 'findAgenda', status: 'completed', steps: 1 },
        { name: 'readPacket', status: 'completed', steps: 3 },
        { name: 'writeBriefing', status: 'completed', steps: 1 },
      ],
      artifact: { briefing_status: 'awaiting_agenda' },
    })
    expect(view.costUsd).toBeCloseTo(5 * 0.0045)
    expect(calls).toEqual([
      'findAgenda:0',
      'readPacket:0',
      'readPacket:1',
      'readPacket:2',
      'writeBriefing:0',
    ])
    expect(
      await service.prisma.meetingResourceLocation.findFirst({
        where: { electedOfficeId: input.electedOfficeId },
      }),
    ).toMatchObject({ description: 'https://example.gov/agendas' })
  })

  it('routes past readPacket when no agenda was found', async () => {
    scriptedModel({ found: false })
    const agents = service.app.get(AgentsService)
    const { runId } = await agents.run(
      'meetingBriefing',
      await seedInput('eo-ai-sdk-route'),
    )
    await service.jobs.settle()

    expect((await agents.getRun(runId)).stages).toMatchObject([
      { name: 'findAgenda', status: 'completed' },
      { name: 'readPacket', status: 'skipped', steps: 0 },
      { name: 'writeBriefing', status: 'completed' },
    ])
  })

  it('resumes a stage from its last saved step after an attempt dies', async () => {
    const calls = scriptedModel({ found: true, failReadPacketStepOnce: 2 })
    const agents = service.app.get(AgentsService)
    const { runId } = await agents.run(
      'meetingBriefing',
      await seedInput('eo-ai-sdk-resume'),
    )
    await service.jobs.settle()

    expect((await agents.getRun(runId)).status).toBe('completed')
    expect(calls).toEqual([
      'findAgenda:0',
      'readPacket:0',
      'readPacket:1',
      'readPacket:2',
      'readPacket:2',
      'writeBriefing:0',
    ])
  })

  const seedStaleRun = async (slug: string, stampedAt: Date) => {
    const input = await seedInput(slug)
    const run = await service.prisma.chatConversation.create({
      data: {
        scope: ChatScope.background_agent,
        organizationSlug: slug,
        agentName: 'meetingBriefing',
        status: AgentRunStatus.running,
        shapeHash: 'an-old-shape',
        shapeStampedAt: stampedAt,
        runInput: input,
      },
    })
    await service.prisma.chatConversation.create({
      data: {
        scope: ChatScope.background_agent,
        organizationSlug: slug,
        agentName: 'findAgenda',
        parentRunId: run.id,
        status: AgentRunStatus.completed,
        shapeHash: 'an-old-shape',
        runOutput: agenda(false),
      },
    })
    await service.app.get(JobsService).send('agentRun', { runId: run.id })
    return run.id
  }

  it('starts a run over when its shape changed under older code', async () => {
    const calls = scriptedModel({ found: false })
    const runId = await seedStaleRun(
      'eo-ai-sdk-shape',
      new Date('2020-01-01T00:00:00Z'),
    )
    await service.jobs.settle()

    const view = await service.app.get(AgentsService).getRun(runId)
    expect(view.status).toBe('completed')
    expect(view.shapeHash).toBe(agentShapeHash(AGENTS.meetingBriefing.stages))
    expect(calls).toEqual(['findAgenda:0', 'writeBriefing:0'])
    expect(
      await service.prisma.chatConversation.count({
        where: { parentRunId: runId, status: AgentRunStatus.superseded },
      }),
    ).toBe(1)
  })

  it('hands back a run stamped by newer code', async () => {
    const calls = scriptedModel({ found: false })
    const runId = await seedStaleRun(
      'eo-ai-sdk-newer',
      new Date(Date.now() + 60 * 60_000),
    )
    const { deadLetters } = await service.jobs.settle({
      allowDeadLetters: true,
    })

    expect(deadLetters).toEqual([
      expect.objectContaining({
        name: 'agentRun',
        error: expect.stringMatching(/handing it back/),
      }),
    ])
    expect(calls).toEqual([])
    expect(
      await service.prisma.chatConversation.count({
        where: { parentRunId: runId, status: AgentRunStatus.completed },
      }),
    ).toBe(1)
  })
})

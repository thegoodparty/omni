import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { fakeModel } from '@langchain/core/testing'
import { isGraphDrained, MemorySaver, RunControl } from '@langchain/langgraph'
import { ModuleRef } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'
import { AgentRunStatus, ChatScope } from '@/generated/prisma'
import { AGENTS } from '@/agents/agents.registry'
import { AgentsService } from '@/agents/agents.service'
import { fullBriefing } from '@/agents/meetingBriefing/meetingBriefingArtifact.fixture'
import { ScriptedChatModel } from '@/shared/test-utils/scriptedChatModel'
import { useTestService } from '@/test-service'
import { LangGraphAgentRuntime } from './langGraphRuntime'
import {
  buildStageGraph,
  shapeHash,
  STAGE_MODEL_CALL_BUDGET,
} from './stageGraph'

const service = useTestService({ jobs: true })

const agenda = {
  found: true,
  briefing_status: 'agenda_found',
  derived_city: 'Hendersonville',
  meeting_name: 'City Council',
  location: 'City Hall',
  meeting_time: '17:45',
  meeting_timezone: 'America/New_York',
  agenda_packet_url: 'https://example.gov/packet.pdf',
  discovered_agenda_location: 'https://example.gov/agendas',
  agenda_availability: 'full_packet',
  documents: [
    {
      url: 'https://example.gov/packet.pdf',
      title: 'Packet',
      kind: 'compiled_packet',
      item_numbers: ['1'],
    },
  ],
  agenda_items: [
    { item_number: '1', title: 'Budget', has_packet_document: true },
  ],
  sources: [],
  run_decisions: [],
}

const packetNotes = {
  substantive_items_found: true,
  triage_source: 'priorities',
  packet_stated_meeting_date: '2026-05-19',
  packet_date_verification: 'matched',
  items: [],
  sources: [],
  run_decisions: [],
}

const finish = (stage: string, args: Record<string, unknown>) =>
  new AIMessage({
    content: '',
    tool_calls: [{ name: stage, args, id: `${stage}-call`, type: 'tool_call' }],
  })

const seedRun = async (slug: string) => {
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

const useModel = (model: ReturnType<typeof fakeModel>) =>
  vi
    .spyOn(service.app.get(LangGraphAgentRuntime), 'chatModel')
    .mockReturnValue(model)

const checkpointCount = async (threadId: string) => {
  const [row] = await service.prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) FROM langgraph.checkpoints WHERE thread_id = ${threadId}`
  return Number(row?.count ?? 0)
}

const types = (messages: BaseMessage[]) => messages.map((m) => m.getType())

describe('LangGraph agent runtime', () => {
  it('runs the three briefing stages, saves the briefing and prunes the checkpoints', async () => {
    const input = await seedRun('eo-lg-full')
    useModel(
      fakeModel()
        .respond(finish('findAgenda_result', agenda))
        .respond(finish('readPacket_result', packetNotes))
        .respond(finish('writeBriefing_result_1', fullBriefing)),
    )

    const { runId } = await service.app
      .get(AgentsService)
      .run('meetingBriefing', input)
    await service.jobs.settle({ timeoutMs: 60_000 })

    const view = await service.app.get(AgentsService).getRun(runId)
    expect(view).toMatchObject({
      runId,
      agent: 'meetingBriefing',
      status: 'completed',
      stages: [
        { name: 'findAgenda', status: 'completed', steps: 1 },
        { name: 'readPacket', status: 'completed', steps: 1 },
        { name: 'writeBriefing', status: 'completed', steps: 1 },
      ],
      artifact: { briefing_status: 'briefing_ready' },
    })
    expect(view.shapeHash).toMatch(/^[0-9a-f]{12}$/)
    expect(
      await service.prisma.meetingBriefing.findFirst({
        where: { electedOfficeId: input.electedOfficeId },
      }),
    ).toMatchObject({ meetingTime: '17:45', artifactKey: null })
    expect(await checkpointCount(runId)).toBe(0)
  })

  it('skips readPacket when no agenda was found, as the routing says', async () => {
    const input = await seedRun('eo-lg-route')
    useModel(
      fakeModel()
        .respond(
          finish('findAgenda_result', {
            ...agenda,
            found: false,
            briefing_status: 'awaiting_agenda',
            documents: [],
          }),
        )
        .respond(finish('writeBriefing_result_1', fullBriefing)),
    )

    const { runId } = await service.app
      .get(AgentsService)
      .run('meetingBriefing', input)
    await service.jobs.settle({ timeoutMs: 60_000 })

    expect(await service.app.get(AgentsService).getRun(runId)).toMatchObject({
      status: 'completed',
      stages: [
        { name: 'findAgenda', status: 'completed' },
        { name: 'readPacket', status: 'skipped', steps: 0 },
        { name: 'writeBriefing', status: 'completed' },
      ],
    })
  })

  it('resumes partway through a stage after a failed attempt, without redoing saved steps', async () => {
    const input = await seedRun('eo-lg-resume')
    const model = fakeModel()
      .respond(finish('findAgenda_result', agenda))
      .respond(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'officialPriorities',
              args: {},
              id: 'priorities-call',
              type: 'tool_call',
            },
          ],
        }),
      )
      .respond(new Error('model provider down'))
      .respond(finish('readPacket_result', packetNotes))
      .respond(finish('writeBriefing_result_1', fullBriefing))
    useModel(model)

    const { runId } = await service.app
      .get(AgentsService)
      .run('meetingBriefing', input)
    await service.jobs.settle({ timeoutMs: 60_000 })

    expect(await service.app.get(AgentsService).getRun(runId)).toMatchObject({
      status: 'completed',
      stages: [
        { name: 'findAgenda', steps: 1 },
        { name: 'readPacket', steps: 2 },
        { name: 'writeBriefing', steps: 1 },
      ],
    })
    // The retry asked the model once more for readPacket, with the saved
    // tool round in hand; findAgenda never ran again.
    expect(model.callCount).toBe(5)
    expect(types(model.calls[3]?.messages ?? [])).toEqual([
      'system',
      'human',
      'ai',
      'tool',
    ])
  })

  it('starts over on a fresh thread when the agent shape changed since the run started', async () => {
    const input = await seedRun('eo-lg-shape')
    useModel(
      fakeModel()
        .respond(finish('findAgenda_result', agenda))
        .respond(finish('readPacket_result', packetNotes))
        .respond(finish('writeBriefing_result_1', fullBriefing)),
    )
    const runtime = service.app.get(LangGraphAgentRuntime)

    const { runId } = await runtime.run('meetingBriefing', input)
    await service.prisma.chatConversation.update({
      where: { id: runId },
      data: { shapeHash: 'stampedolder' },
    })
    await service.jobs.settle({ timeoutMs: 60_000 })

    const view = await runtime.getRun(runId)
    expect(view.status).toBe('completed')
    expect(view.runId).not.toBe(runId)
    expect(view.shapeHash).not.toBe('stampedolder')
    expect(
      await service.prisma.chatConversation.findUniqueOrThrow({
        where: { id: runId },
      }),
    ).toMatchObject({ runStatus: AgentRunStatus.superseded, costUsd: 0 })
    expect(
      await service.prisma.chatConversation.findUniqueOrThrow({
        where: { id: view.runId },
      }),
    ).toMatchObject({ parentRunId: runId })
  })

  it('hands a run stamped by newer code back instead of restarting it', async () => {
    const input = await seedRun('eo-lg-newer')
    const runtime = service.app.get(LangGraphAgentRuntime)
    useModel(fakeModel())
    await service.prisma.chatConversation.create({
      data: {
        scope: ChatScope.background_agent,
        agent: 'meetingBriefing',
        shapeHash: shapeHash(AGENTS.meetingBriefing),
        runStatus: AgentRunStatus.completed,
      },
    })

    const { runId } = await runtime.run('meetingBriefing', input)
    await service.prisma.chatConversation.update({
      where: { id: runId },
      data: { shapeHash: 'stampednewer', createdAt: new Date(Date.now() + 1) },
    })

    const { deadLetters } = await service.jobs.settle({
      timeoutMs: 60_000,
      allowDeadLetters: true,
    })
    expect(deadLetters).toContainEqual({
      name: 'agentRun',
      data: { runId },
      error: expect.stringMatching(/stamped by newer code/),
    })
    expect(
      await service.prisma.chatConversation.findUniqueOrThrow({
        where: { id: runId },
      }),
    ).toMatchObject({
      runStatus: AgentRunStatus.queued,
      shapeHash: 'stampednewer',
    })
  })

  it('makes a stage answer once it has used its model-call budget', async () => {
    const input = await seedRun('eo-lg-budget')
    const loop = (i: number) =>
      new AIMessage({
        content: '',
        tool_calls: [
          {
            name: 'officialPriorities',
            args: {},
            id: `p${i}`,
            type: 'tool_call',
          },
        ],
      })
    const model = fakeModel().respond(finish('findAgenda_result', agenda))
    for (let i = 0; i < STAGE_MODEL_CALL_BUDGET; i += 1) model.respond(loop(i))
    model
      .respond(finish('readPacket_result', packetNotes))
      .respond(finish('writeBriefing_result_1', fullBriefing))
    useModel(model)

    const { runId } = await service.app
      .get(AgentsService)
      .run('meetingBriefing', input)
    await service.jobs.settle({ timeoutMs: 120_000 })

    expect(await service.app.get(AgentsService).getRun(runId)).toMatchObject({
      status: 'completed',
      stages: [
        { name: 'findAgenda', steps: 1 },
        { name: 'readPacket', steps: STAGE_MODEL_CALL_BUDGET + 1 },
        { name: 'writeBriefing', steps: 1 },
      ],
    })
    const nudged = model.calls[STAGE_MODEL_CALL_BUDGET + 1]?.messages.at(-1)
    expect(nudged?.text).toMatch(/return your result now/)
  }, 150_000)

  it('fails a run whose stage loops past its step limit, without retrying it', async () => {
    const input = await seedRun('eo-lg-runaway')
    const model = new ScriptedChatModel([
      {
        text: '',
        toolCalls: [{ name: 'findAgenda_result', args: agenda, id: 'f' }],
      },
      {
        text: '',
        toolCalls: [{ name: 'officialPriorities', args: {}, id: 'loop' }],
      },
    ])
    vi.spyOn(
      service.app.get(LangGraphAgentRuntime),
      'chatModel',
    ).mockReturnValue(model)
    const generate = vi.spyOn(model, '_generate')

    const { runId } = await service.app
      .get(AgentsService)
      .run('meetingBriefing', input)
    await service.jobs.settle({ timeoutMs: 120_000 })

    expect(await service.app.get(AgentsService).getRun(runId)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/Recursion limit/),
    })
    // One attempt's worth of loop: about half the step limit in model calls.
    expect(generate.mock.calls.length).toBeGreaterThan(100)
    expect(generate.mock.calls.length).toBeLessThan(250)
  }, 150_000)

  it('drains at the next step when asked, and resumes from the saved step', async () => {
    const input = await seedRun('eo-lg-drain')
    const control = new RunControl()
    const model = fakeModel()
      .respond(finish('findAgenda_result', agenda))
      .respond(() => {
        control.requestDrain('shutdown')
        return new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'officialPriorities',
              args: {},
              id: 'priorities-call',
              type: 'tool_call',
            },
          ],
        })
      })
      .respond(finish('readPacket_result', packetNotes))
      .respond(finish('writeBriefing_result_1', fullBriefing))
    const graph = buildStageGraph(AGENTS.meetingBriefing, {
      checkpointer: new MemorySaver(),
      chatModel: () => model,
      run: {
        runId: 'drain-run',
        organizationSlug: input.organizationSlug,
        moduleRef: service.app.get(ModuleRef),
        signal: new AbortController().signal,
      },
    })
    const config = { configurable: { thread_id: 'drain-run' } }

    const drained = await graph
      .invoke({ input }, { ...config, control })
      .catch((err: unknown) => err)
    expect(isGraphDrained(drained)).toBe(true)
    expect(model.callCount).toBe(2)

    const state: Record<string, unknown> = await graph.invoke(null, config)
    expect(state.writeBriefingOutput).toMatchObject({
      briefing_status: 'briefing_ready',
    })
    expect(model.callCount).toBe(4)
    expect(types(model.calls[2]?.messages ?? [])).toEqual([
      'system',
      'human',
      'ai',
      'tool',
    ])
  })
})

describe('shapeHash', () => {
  const agent = AGENTS.meetingBriefing
  const stages = agent.stages

  it('ignores prompts, models and tools', () => {
    const tweaked = Object.fromEntries(
      Object.entries(stages).map(([name, stage]) => [
        name,
        { ...stage, prompt: 'other.md', model: 'claude-opus-4-7', tools: [] },
      ]),
    )
    expect(shapeHash({ ...agent, stages: tweaked })).toBe(shapeHash(agent))
  })

  it('changes with a stage output schema or the stage list', () => {
    const { readPacket, ...rest } = stages
    expect(shapeHash({ ...agent, stages: rest })).not.toBe(shapeHash(agent))
    if (!readPacket) throw new Error('readPacket stage missing')
    expect(
      shapeHash({
        ...agent,
        stages: {
          ...stages,
          readPacket: { ...readPacket, output: agent.output },
        },
      }),
    ).not.toBe(shapeHash(agent))
  })
})

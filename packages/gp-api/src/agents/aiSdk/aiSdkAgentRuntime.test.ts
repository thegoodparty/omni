import type {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentRunStatus, ChatMessageRole, ChatScope } from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { useTestService } from '@/test-service'
import { AgentsService } from '../agents.service'
import { AGENTS } from '../agents.registry'
import { placeholder } from '../meetingBriefing/meetingBriefingArtifact.fixture'
import { AgentModels } from './agentModels'
import { agentShapeHash } from './shapeHash'

const service = useTestService({ jobs: true })

const asStream = (
  result: LanguageModelV3GenerateResult,
): LanguageModelV3StreamResult => ({
  stream: simulateReadableStream<LanguageModelV3StreamPart>({
    chunks: [
      { type: 'stream-start', warnings: [] },
      ...result.content.flatMap((part) =>
        part.type === 'tool-call' ? [part] : [],
      ),
      {
        type: 'finish',
        finishReason: result.finishReason,
        usage: result.usage,
      },
    ],
  }),
})

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

// A scripted model: which step it is on comes from the assistant turns
// already in the prompt. Two officialPriorities calls, then the placeholder.
const scriptedModel = (
  script: { failStepOnce?: number; cutOffOnce?: boolean } = {},
) => {
  const calls: number[] = []
  let failOnce = script.failStepOnce
  let cutOff = script.cutOffOnce
  const respond = async (
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> => {
    const step = options.prompt.filter((m) => m.role === 'assistant').length
    calls.push(step)
    if (step === failOnce) {
      failOnce = undefined
      throw new Error('the worker died mid-run')
    }
    if (cutOff) {
      cutOff = false
      return {
        ...toolCall('submitOutput', {}),
        content: [],
        finishReason: { unified: 'length', raw: 'max_tokens' },
      }
    }
    return step < 2
      ? toolCall('officialPriorities', {})
      : toolCall('submitOutput', { output: placeholder })
  }
  const model = new MockLanguageModelV3({
    doStream: async (options) => asStream(await respond(options)),
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

const SHAPE = agentShapeHash(AGENTS.meetingBriefing.output)

describe('AI SDK agent runtime', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('runs the agent as a pg-boss job on one conversation and saves the artifact', async () => {
    const calls = scriptedModel()
    const input = await seedInput('eo-ai-sdk-run')
    const agents = service.app.get(AgentsService)

    const { runId } = await agents.run('meetingBriefing', input)
    await service.jobs.settle()

    const view = await agents.getRun(runId)
    expect(view).toMatchObject({
      agent: 'meetingBriefing',
      status: 'completed',
      shapeHash: SHAPE,
      steps: 3,
      artifact: { briefing_status: 'awaiting_agenda' },
    })
    expect(view.costUsd).toBeCloseTo(3 * 0.0045)
    expect(calls).toEqual([0, 1, 2])
    expect(
      await service.prisma.chatMessage.findMany({
        where: { conversationId: runId },
        orderBy: { createdAt: 'asc' },
        select: { role: true },
      }),
    ).toEqual([
      { role: 'user' },
      { role: 'assistant' },
      { role: 'assistant' },
      { role: 'assistant' },
    ])
    expect(
      await service.prisma.meetingResourceLocation.findFirst({
        where: { electedOfficeId: input.electedOfficeId },
      }),
    ).toMatchObject({ description: 'https://example.gov/agendas' })
  })

  it('resumes from the last saved step after an attempt dies', async () => {
    const calls = scriptedModel({ failStepOnce: 2 })
    const agents = service.app.get(AgentsService)
    const { runId } = await agents.run(
      'meetingBriefing',
      await seedInput('eo-ai-sdk-resume'),
    )
    await service.jobs.settle()

    expect(await agents.getRun(runId)).toMatchObject({
      status: 'completed',
      steps: 3,
    })
    expect(calls).toEqual([0, 1, 2, 2])
  })

  it('asks again when a reply is cut off at the output limit', async () => {
    const calls = scriptedModel({ cutOffOnce: true })
    const agents = service.app.get(AgentsService)
    const { runId } = await agents.run(
      'meetingBriefing',
      await seedInput('eo-ai-sdk-cut-off'),
    )
    await service.jobs.settle()

    expect((await agents.getRun(runId)).status).toBe('completed')
    expect(calls).toEqual([0, 0, 1, 2])
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
        messages: {
          create: [
            { role: ChatMessageRole.user, content: JSON.stringify(input) },
            {
              role: ChatMessageRole.assistant,
              content: 'an old step',
              model: 'claude-sonnet-4-6',
              step: {
                messages: [
                  {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'an old step' }],
                  },
                ],
                usage: {
                  inputTokens: 1000,
                  outputTokens: 100,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                  webSearches: 0,
                },
              },
            },
          ],
        },
      },
    })
    await service.app.get(JobsService).send('agentRun', { runId: run.id })
    return run.id
  }

  it('supersedes a run whose shape changed under older code and finishes a fresh one', async () => {
    const calls = scriptedModel()
    const runId = await seedStaleRun(
      'eo-ai-sdk-shape',
      new Date('2020-01-01T00:00:00Z'),
    )
    await service.jobs.settle()

    const agents = service.app.get(AgentsService)
    const old = await agents.getRun(runId)
    expect(old).toMatchObject({
      status: 'superseded',
      shapeHash: 'an-old-shape',
      steps: 1,
      supersededBy: expect.any(String),
    })
    expect(old.costUsd).toBeCloseTo(0.0045)
    expect(await agents.getRun(old.supersededBy ?? '')).toMatchObject({
      status: 'completed',
      shapeHash: SHAPE,
      steps: 3,
    })
    expect(calls).toEqual([0, 1, 2])
  })

  it('hands back a run stamped by newer code', async () => {
    const calls = scriptedModel()
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
    expect(await service.app.get(AgentsService).getRun(runId)).toMatchObject({
      status: 'running',
      steps: 1,
    })
    expect(
      await service.prisma.chatConversation.count({
        where: { organizationSlug: 'eo-ai-sdk-newer' },
      }),
    ).toBe(1)
  })
})

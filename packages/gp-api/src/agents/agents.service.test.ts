import type {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { z } from 'zod'
import {
  ChatMessageRole,
  ChatScope,
  ExperimentRunStatus,
} from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { useTestService } from '@/test-service'
import { AgentModels } from './agentModels'
import { AGENTS } from './agents.registry'
import { AgentsService } from './agents.service'
import { defineAgent } from './defineAgent'
import { agentShapeHash } from './shapeHash'

const service = useTestService({ jobs: true })

const OutputSchema = z.object({ summary: z.string() })
const SHAPE = agentShapeHash(OutputSchema)

let lookUps: string[] = []
let artifacts: unknown[] = []

const testAgent = defineAgent({
  input: z.object({ organizationSlug: z.string(), topic: z.string() }),
  output: OutputSchema,
  model: 'claude-sonnet-4-6',
  prompt: 'Look the topic up twice, then summarize it.',
  tools: [
    {
      name: 'lookUp',
      description: 'Look the topic up.',
      input: z.object({}),
      execute: async (_input, ctx) => {
        lookUps.push(ctx.stepKey)
        return { found: 'https://example.gov/topic' }
      },
    },
  ],
  onArtifact: async (artifact, run, { get }) => {
    artifacts.push({
      artifact,
      runId: run.runId,
      topic: run.input.topic,
      models: get(AgentModels) instanceof AgentModels,
    })
  },
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

// Which step the model is on comes from the assistant turns already in the
// prompt: two lookUp calls, then the output.
const scriptedModel = (script: { failStepOnce?: number } = {}) => {
  const calls: number[] = []
  let failOnce = script.failStepOnce
  const respond = (
    options: LanguageModelV3CallOptions,
  ): LanguageModelV3GenerateResult => {
    const step = options.prompt.filter((m) => m.role === 'assistant').length
    calls.push(step)
    if (step === failOnce) {
      failOnce = undefined
      throw new Error('the worker died mid-run')
    }
    return step < 2
      ? toolCall('lookUp', {})
      : toolCall('submitOutput', { output: { summary: 'all about it' } })
  }
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      const result = respond(options)
      return {
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
      }
    },
  })
  vi.spyOn(service.app.get(AgentModels), 'languageModel').mockReturnValue(model)
  return calls
}

const seedOrg = async (slug: string) => {
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return { organizationSlug: slug, topic: 'zoning' }
}

const stepRows = (runId: string) =>
  service.prisma.chatMessage.findMany({
    where: { conversation: { experimentRunId: runId } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { role: true, inputTokens: true, outputTokens: true },
  })

describe('AgentsService', () => {
  beforeAll(() => {
    AGENTS.testAgent = testAgent
  })

  afterAll(() => {
    delete AGENTS.testAgent
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    lookUps = []
    artifacts = []
  })

  it('runs the agent as a job, one step per row, and saves the artifact', async () => {
    const calls = scriptedModel()
    const input = await seedOrg('agents-run')

    const { runId } = await service.app
      .get(AgentsService)
      .run('testAgent', input)
    await service.jobs.settle()

    const run = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId },
      include: { conversation: true },
    })
    expect(run).toMatchObject({
      experimentType: 'testAgent',
      organizationSlug: 'agents-run',
      status: ExperimentRunStatus.COMPLETED,
      params: input,
      shapeHash: SHAPE,
      artifactKey: null,
      error: null,
      conversation: {
        scope: ChatScope.background_agent,
        ownerUserId: null,
        organizationSlug: 'agents-run',
      },
    })
    expect(run.costUsd).toBeCloseTo(3 * 0.0045)
    expect(run.durationSeconds).toBeGreaterThanOrEqual(0)
    expect(calls).toEqual([0, 1, 2])
    expect(lookUps).toEqual(['0:lookUp:0', '1:lookUp:0'])
    expect(await stepRows(runId)).toEqual([
      { role: ChatMessageRole.user, inputTokens: null, outputTokens: null },
      { role: ChatMessageRole.assistant, inputTokens: 1000, outputTokens: 100 },
      { role: ChatMessageRole.assistant, inputTokens: 1000, outputTokens: 100 },
      { role: ChatMessageRole.assistant, inputTokens: 1000, outputTokens: 100 },
    ])
    expect(artifacts).toEqual([
      {
        artifact: { summary: 'all about it' },
        runId,
        topic: 'zoning',
        models: true,
      },
    ])
  })

  it('resumes from the last saved step after an attempt dies', async () => {
    const calls = scriptedModel({ failStepOnce: 2 })

    const { runId } = await service.app
      .get(AgentsService)
      .run('testAgent', await seedOrg('agents-resume'))
    await service.jobs.settle()

    expect(
      await service.prisma.experimentRun.findUniqueOrThrow({
        where: { runId },
      }),
    ).toMatchObject({ status: ExperimentRunStatus.COMPLETED })
    expect(calls).toEqual([0, 1, 2, 2])
    expect(lookUps).toEqual(['0:lookUp:0', '1:lookUp:0'])
    expect(await stepRows(runId)).toHaveLength(4)
    expect(artifacts).toHaveLength(1)
  })

  it('supersedes a run whose shape changed and finishes a fresh one', async () => {
    const calls = scriptedModel()
    const input = await seedOrg('agents-shape')
    const stale = await service.prisma.experimentRun.create({
      data: {
        experimentType: 'testAgent',
        organizationSlug: input.organizationSlug,
        status: ExperimentRunStatus.RUNNING,
        params: input,
        shapeHash: 'an-old-shape',
        conversation: {
          create: {
            scope: ChatScope.background_agent,
            organizationSlug: input.organizationSlug,
            messages: {
              create: [
                { role: ChatMessageRole.user, content: JSON.stringify(input) },
                {
                  role: ChatMessageRole.assistant,
                  content: 'an old step',
                  model: 'claude-sonnet-4-6',
                  inputTokens: 1000,
                  outputTokens: 100,
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
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })
    await service.app.get(JobsService).send('agentRun', { runId: stale.runId })
    await service.jobs.settle()

    const old = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: stale.runId },
    })
    expect(old).toMatchObject({
      status: ExperimentRunStatus.SUPERSEDED,
      shapeHash: 'an-old-shape',
    })
    expect(old.costUsd).toBeCloseTo(0.0045)
    expect(old.durationSeconds).toBeGreaterThanOrEqual(0)
    expect(await stepRows(stale.runId)).toHaveLength(2)

    const fresh = await service.prisma.experimentRun.findFirstOrThrow({
      where: {
        organizationSlug: input.organizationSlug,
        runId: { not: stale.runId },
      },
    })
    expect(fresh).toMatchObject({
      experimentType: 'testAgent',
      status: ExperimentRunStatus.COMPLETED,
      shapeHash: SHAPE,
      params: input,
    })
    expect(calls).toEqual([0, 1, 2])
    expect(artifacts).toEqual([expect.objectContaining({ runId: fresh.runId })])
  })

  it('fails the run on its last attempt with the error', async () => {
    vi.spyOn(service.app.get(AgentModels), 'languageModel').mockReturnValue(
      new MockLanguageModelV3({
        doStream: async () => {
          throw new Error('provider down')
        },
      }),
    )

    const { runId } = await service.app
      .get(AgentsService)
      .run('testAgent', await seedOrg('agents-fail'))
    const { deadLetters } = await service.jobs.settle({
      allowDeadLetters: true,
    })

    expect(deadLetters).toEqual([
      expect.objectContaining({ name: 'agentRun', error: 'provider down' }),
    ])
    expect(
      await service.prisma.experimentRun.findUniqueOrThrow({
        where: { runId },
      }),
    ).toMatchObject({
      status: ExperimentRunStatus.FAILED,
      error: 'provider down',
      costUsd: 0,
    })
    expect(artifacts).toEqual([])
  })

  it('fails a queued run whose agent is no longer registered', async () => {
    const input = await seedOrg('agents-removed')
    const orphan = await service.prisma.experimentRun.create({
      data: {
        experimentType: 'removedAgent',
        organizationSlug: input.organizationSlug,
        status: ExperimentRunStatus.QUEUED,
        params: input,
        shapeHash: SHAPE,
        conversation: {
          create: {
            scope: ChatScope.background_agent,
            organizationSlug: input.organizationSlug,
          },
        },
      },
    })
    await service.app.get(JobsService).send('agentRun', { runId: orphan.runId })
    await service.jobs.settle({ allowDeadLetters: true })

    expect(
      await service.prisma.experimentRun.findUniqueOrThrow({
        where: { runId: orphan.runId },
      }),
    ).toMatchObject({
      status: ExperimentRunStatus.FAILED,
      error: 'no agent named removedAgent',
    })
  })

  it('refuses an input the agent does not accept, and an unknown agent', async () => {
    const agents = service.app.get(AgentsService)
    await expect(
      agents.run('testAgent', { organizationSlug: 'agents-bad' }),
    ).rejects.toThrow()
    await expect(
      agents.run('noSuchAgent', { organizationSlug: 'agents-bad' }),
    ).rejects.toThrow(/no agent named noSuchAgent/)
    expect(await service.prisma.experimentRun.count()).toBe(0)
  })
})

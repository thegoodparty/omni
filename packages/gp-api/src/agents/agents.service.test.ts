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
import { AgentMessageRole, AgentRunStatus } from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { useTestService } from '@/test-service'
import { AgentModels } from './agentModels'
import { AGENTS } from './agents.registry'
import { AgentsService } from './agents.service'
import { defineAgent } from './defineAgent'
import { agentManifest, manifestShapeHash } from './manifest'

const service = useTestService({ jobs: true })

const OutputSchema = z.object({ summary: z.string() })
const InputSchema = z.object({
  organizationSlug: z.string(),
  topic: z.string(),
})

let lookUps: string[] = []
let artifacts: { runId: string; topic: string; artifact: unknown }[] = []

const testAgent = defineAgent({
  input: InputSchema,
  output: OutputSchema,
  model: 'claude-sonnet-4-6',
  prompt: 'Look the topic up twice, then summarize it.',
  tools: {
    lookUp: {
      description: 'Look the topic up.',
      input: z.object({}),
      execute: async (_input, ctx) => {
        lookUps.push(ctx.stepKey)
        return { found: 'https://example.gov/topic' }
      },
    },
  },
  onArtifact: async (artifact, run) => {
    artifacts.push({ runId: run.runId, topic: run.input.topic, artifact })
  },
})

const MANIFEST = agentManifest(testAgent)
const SHAPE = manifestShapeHash(MANIFEST)

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
    inputTokens: { total: 1000, noCache: 900, cacheRead: 100, cacheWrite: 0 },
    outputTokens: { total: 100, text: 100, reasoning: undefined },
  },
  warnings: [],
})

// Which step the model is on comes from the assistant messages already in the
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
  vi.spyOn(service.app.get(AgentModels), 'resolve').mockReturnValue({
    model,
    modelId: 'claude-sonnet-4-6',
    provider: 'anthropic',
  })
  return calls
}

const seedOrg = async (slug: string) => {
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return { organizationSlug: slug, topic: 'zoning' }
}

const rows = (runId: string) =>
  service.prisma.agentMessage.findMany({
    where: { agentRunId: runId },
    orderBy: { index: 'asc' },
    select: {
      index: true,
      role: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheWriteTokens: true,
    },
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

  it('runs the agent as a job, one AgentMessage row per message, and saves the artifact', async () => {
    const calls = scriptedModel()
    const input = await seedOrg('agents-run')

    const { runId } = await service.app
      .get(AgentsService)
      .run('testAgent', input)
    await service.jobs.settle()

    const run = await service.prisma.agentRun.findUniqueOrThrow({
      where: { id: runId },
    })
    expect(run).toMatchObject({
      agentName: 'testAgent',
      organizationSlug: 'agents-run',
      status: AgentRunStatus.completed,
      input,
      manifest: MANIFEST,
      shapeHash: SHAPE,
      artifact: { summary: 'all about it' },
      error: null,
    })
    expect(run.startedAt).not.toBeNull()
    expect(run.finishedAt).not.toBeNull()
    expect(calls).toEqual([0, 1, 2])
    expect(lookUps).toEqual(['0:lookUp:0', '1:lookUp:0'])

    // The input row, then for each step the assistant message and the tool
    // result it produced. Only the assistant rows carry a model and tokens.
    expect(await rows(runId)).toEqual([
      {
        index: 0,
        role: AgentMessageRole.user,
        model: null,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
      {
        index: 1,
        role: AgentMessageRole.assistant,
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
      },
      {
        index: 2,
        role: AgentMessageRole.tool,
        model: null,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
      {
        index: 3,
        role: AgentMessageRole.assistant,
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
      },
      {
        index: 4,
        role: AgentMessageRole.tool,
        model: null,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
      {
        index: 5,
        role: AgentMessageRole.assistant,
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
      },
      {
        index: 6,
        role: AgentMessageRole.tool,
        model: null,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
    ])
    expect(artifacts).toEqual([
      { runId, topic: 'zoning', artifact: { summary: 'all about it' } },
    ])
  })

  it('resumes from the saved messages after an attempt dies', async () => {
    const calls = scriptedModel({ failStepOnce: 2 })

    const { runId } = await service.app
      .get(AgentsService)
      .run('testAgent', await seedOrg('agents-resume'))
    await service.jobs.settle()

    expect(
      await service.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }),
    ).toMatchObject({ status: AgentRunStatus.completed })
    // The killed attempt redid its last step on the retry, and only the
    // completed messages are rows.
    expect(calls).toEqual([0, 1, 2, 2])
    expect(lookUps).toEqual(['0:lookUp:0', '1:lookUp:0'])
    expect(await rows(runId)).toHaveLength(7)
    expect(artifacts).toHaveLength(1)
  })

  it('supersedes a run whose manifest changed and finishes a fresh one from the same input', async () => {
    const calls = scriptedModel()
    const input = await seedOrg('agents-shape')
    const stale = await service.prisma.agentRun.create({
      data: {
        agentName: 'testAgent',
        organizationSlug: input.organizationSlug,
        status: AgentRunStatus.running,
        manifest: MANIFEST,
        shapeHash: 'an-old-shape',
        input,
        messages: {
          create: [
            {
              index: 0,
              role: AgentMessageRole.user,
              parts: [{ type: 'text', text: JSON.stringify(input) }],
            },
            {
              index: 1,
              role: AgentMessageRole.assistant,
              parts: [{ type: 'text', text: 'an old step' }],
              model: 'claude-sonnet-4-6',
              inputTokens: 1000,
              outputTokens: 100,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
          ],
        },
      },
    })
    await service.app.get(JobsService).send('agentRun', { runId: stale.id })
    await service.jobs.settle()

    const old = await service.prisma.agentRun.findUniqueOrThrow({
      where: { id: stale.id },
    })
    expect(old).toMatchObject({
      status: AgentRunStatus.superseded,
      shapeHash: 'an-old-shape',
    })
    expect(old.finishedAt).not.toBeNull()
    // The superseded run keeps its messages and its artifact stays empty.
    expect(await rows(stale.id)).toHaveLength(2)
    expect(old.artifact).toBeNull()

    const fresh = await service.prisma.agentRun.findFirstOrThrow({
      where: {
        organizationSlug: input.organizationSlug,
        id: { not: stale.id },
      },
    })
    expect(fresh).toMatchObject({
      agentName: 'testAgent',
      status: AgentRunStatus.completed,
      shapeHash: SHAPE,
      input,
      artifact: { summary: 'all about it' },
    })
    expect(calls).toEqual([0, 1, 2])
    expect(artifacts).toEqual([expect.objectContaining({ runId: fresh.id })])
  })

  it('treats an input schema change as a shape change too', async () => {
    // The manifest is the input schema as well as the output one: widening what
    // an agent accepts changes what its saved rows mean, so it restarts.
    const widened = defineAgent({
      input: z.object({
        organizationSlug: z.string(),
        topic: z.string(),
        state: z.string(),
      }),
      output: OutputSchema,
      model: 'claude-sonnet-4-6',
      prompt: 'Look the topic up twice, then summarize it.',
      tools: {},
      onArtifact: async () => undefined,
    })
    expect(manifestShapeHash(agentManifest(widened))).not.toBe(SHAPE)
  })

  it('runs onArtifact from the stored artifact when an attempt died after saving it', async () => {
    const input = await seedOrg('agents-artifact-crash')
    // The exact state a task leaves behind when it saves the accepted output
    // and dies before onArtifact: the artifact is on the run, its messages end
    // in the accepted submitOutput call, and the run is still running.
    const crashed = await service.prisma.agentRun.create({
      data: {
        agentName: 'testAgent',
        organizationSlug: input.organizationSlug,
        status: AgentRunStatus.running,
        manifest: MANIFEST,
        shapeHash: SHAPE,
        input,
        artifact: { summary: 'all about it' },
        messages: {
          create: [
            {
              index: 0,
              role: AgentMessageRole.user,
              parts: [{ type: 'text', text: JSON.stringify(input) }],
            },
            {
              index: 1,
              role: AgentMessageRole.assistant,
              parts: [
                {
                  type: 'tool-call',
                  toolCallId: 'call-1',
                  toolName: 'submitOutput',
                  input: { output: { summary: 'all about it' } },
                },
              ],
              model: 'claude-sonnet-4-6',
              inputTokens: 1000,
              outputTokens: 100,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
            {
              index: 2,
              role: AgentMessageRole.tool,
              parts: [
                {
                  type: 'tool-result',
                  toolCallId: 'call-1',
                  toolName: 'submitOutput',
                  output: { type: 'text', value: 'accepted' },
                },
              ],
            },
          ],
        },
      },
    })
    vi.spyOn(service.app.get(AgentModels), 'resolve').mockReturnValue({
      model: new MockLanguageModelV3({
        doStream: async () => {
          throw new Error('no model call expected')
        },
      }),
      modelId: 'claude-sonnet-4-6',
      provider: 'anthropic',
    })

    await service.app.get(JobsService).send('agentRun', { runId: crashed.id })
    await service.jobs.settle()

    expect(artifacts).toEqual([
      {
        runId: crashed.id,
        topic: 'zoning',
        artifact: { summary: 'all about it' },
      },
    ])
    expect(
      await service.prisma.agentRun.findUniqueOrThrow({
        where: { id: crashed.id },
      }),
    ).toMatchObject({
      status: AgentRunStatus.completed,
      artifact: { summary: 'all about it' },
    })
  })

  it('calls onArtifact again and makes no model call when the output was already accepted', async () => {
    const calls = scriptedModel()
    const input = await seedOrg('agents-idempotent')
    const { runId } = await service.app
      .get(AgentsService)
      .run('testAgent', input)
    await service.jobs.settle()
    expect(artifacts).toHaveLength(1)

    // What a retry finds after a task died between onArtifact and the run being
    // marked complete: the accepted output is on the run, and its messages end
    // in the submitOutput call.
    await service.prisma.agentRun.update({
      where: { id: runId },
      data: { status: AgentRunStatus.running, finishedAt: null },
    })
    await service.app.get(JobsService).send('agentRun', { runId })
    await service.jobs.settle()

    expect(calls).toEqual([0, 1, 2])
    expect(artifacts).toHaveLength(2)
    expect(
      await service.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }),
    ).toMatchObject({ status: AgentRunStatus.completed })
  })

  it('refuses a message with no parent and one with two', async () => {
    const input = await seedOrg('agents-constraint')
    const run = await service.prisma.agentRun.create({
      data: {
        agentName: 'testAgent',
        organizationSlug: input.organizationSlug,
        status: AgentRunStatus.queued,
        manifest: MANIFEST,
        shapeHash: SHAPE,
        input,
      },
    })
    const conversation = await service.prisma.chatConversation.create({
      data: {
        ownerUserId: service.user.id,
        scope: 'chief_of_staff',
        organizationSlug: input.organizationSlug,
      },
    })

    await expect(
      service.prisma.agentMessage.create({
        data: { index: 0, role: AgentMessageRole.user, parts: [] },
      }),
    ).rejects.toThrow(/agent_message_one_parent/)
    await expect(
      service.prisma.agentMessage.create({
        data: {
          index: 0,
          role: AgentMessageRole.user,
          parts: [],
          agentRunId: run.id,
          conversationId: conversation.id,
        },
      }),
    ).rejects.toThrow(/agent_message_one_parent/)
  })

  it('refuses a second message at the same index in one parent', async () => {
    const input = await seedOrg('agents-index')
    const run = await service.prisma.agentRun.create({
      data: {
        agentName: 'testAgent',
        organizationSlug: input.organizationSlug,
        status: AgentRunStatus.queued,
        manifest: MANIFEST,
        shapeHash: SHAPE,
        input,
        messages: {
          create: { index: 0, role: AgentMessageRole.user, parts: [] },
        },
      },
    })

    await expect(
      service.prisma.agentMessage.create({
        data: {
          index: 0,
          role: AgentMessageRole.assistant,
          parts: [],
          agentRunId: run.id,
        },
      }),
    ).rejects.toThrow(
      /Unique constraint failed on the fields: \(`agent_run_id`,`index`\)/,
    )
  })

  it('fails the run on its last attempt with the error', async () => {
    vi.spyOn(service.app.get(AgentModels), 'resolve').mockReturnValue({
      model: new MockLanguageModelV3({
        doStream: async () => {
          throw new Error('provider down')
        },
      }),
      modelId: 'claude-sonnet-4-6',
      provider: 'anthropic',
    })

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
      await service.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }),
    ).toMatchObject({
      status: AgentRunStatus.failed,
      error: 'provider down',
      artifact: null,
    })
    expect(artifacts).toEqual([])
  })

  it('fails a queued run whose agent is no longer registered', async () => {
    const input = await seedOrg('agents-removed')
    const orphan = await service.prisma.agentRun.create({
      data: {
        agentName: 'removedAgent',
        organizationSlug: input.organizationSlug,
        status: AgentRunStatus.queued,
        manifest: MANIFEST,
        shapeHash: SHAPE,
        input,
      },
    })
    await service.app.get(JobsService).send('agentRun', { runId: orphan.id })
    await service.jobs.settle({ allowDeadLetters: true })

    expect(
      await service.prisma.agentRun.findUniqueOrThrow({
        where: { id: orphan.id },
      }),
    ).toMatchObject({
      status: AgentRunStatus.failed,
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
    expect(await service.prisma.agentRun.count()).toBe(0)
  })
})

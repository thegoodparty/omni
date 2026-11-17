import { setTimeout as sleep } from 'node:timers/promises'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { ModuleRef } from '@nestjs/core'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { PinoLogger } from 'nestjs-pino'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { AgentMessageRole, AgentRunStatus } from '@/generated/prisma'
import { JOBS, SCHEDULES } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { PrismaService } from '@/prisma/prisma.service'
import { useTestService } from '@/test-service'
import { AgentModels } from './agentModels'
import { AGENTS } from './agents.registry'
import { AgentsService } from './agents.service'
import { defineAgent } from './defineAgent'

// A deploy stopping a run part way through. The test app runs no workers; a
// stand-in gp-api task does, stopped while the run's second model call is in
// flight.
const service = useTestService()

const startTask = async (): Promise<JobsService> => {
  const task = new JobsService(
    JOBS,
    SCHEDULES,
    service.app.get(PrismaService),
    service.app.get(ModuleRef),
    await service.app.resolve(PinoLogger),
  )
  vi.stubEnv('TEST_JOBS', 'on')
  try {
    await task.onModuleInit()
    await task.onApplicationBootstrap()
  } finally {
    vi.unstubAllEnvs()
  }
  return task
}

const waitFor = async (check: () => boolean) => {
  const deadline = performance.now() + 15_000
  while (!check()) {
    if (performance.now() > deadline) throw new Error('waitFor timed out')
    await sleep(100)
  }
}

const lookUpCall = (): LanguageModelV3StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  {
    type: 'tool-call',
    toolCallId: `call-${Math.random().toString(36).slice(2)}`,
    toolName: 'lookUp',
    input: '{}',
  },
  {
    type: 'finish',
    finishReason: { unified: 'tool-calls', raw: 'tool_use' },
    usage: {
      inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 100, text: 100, reasoning: undefined },
    },
  },
]

describe('an agent run at shutdown', () => {
  beforeAll(() => {
    AGENTS.testAgent = defineAgent({
      input: z.object({ organizationSlug: z.string() }),
      output: z.object({ summary: z.string() }),
      model: 'claude-sonnet-4-6',
      prompt: 'Keep looking it up.',
      tools: [
        {
          name: 'lookUp',
          description: 'Look it up.',
          input: z.object({}),
          execute: async () => 'nothing yet',
        },
      ],
      onArtifact: async () => undefined,
    })
  })

  afterAll(() => {
    delete AGENTS.testAgent
  })

  it('stops after its current step, with the messages saved and the run not failed', async () => {
    let calls = 0
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(service.app.get(AgentModels), 'resolve').mockReturnValue({
      model: new MockLanguageModelV3({
        doStream: async () => {
          calls++
          if (calls === 2) await released
          return { stream: simulateReadableStream({ chunks: lookUpCall() }) }
        },
      }),
      modelId: 'claude-sonnet-4-6',
      provider: 'anthropic',
    })
    await service.prisma.organization.create({
      data: { slug: 'agents-shutdown', ownerId: service.user.id },
    })

    const { runId } = await service.app
      .get(AgentsService)
      .run('testAgent', { organizationSlug: 'agents-shutdown' })
    const task = await startTask()
    await waitFor(() => calls === 2)
    const stopping = task.onModuleDestroy()
    release()
    await stopping

    expect(calls).toBe(2)
    const run = await service.prisma.agentRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        messages: {
          orderBy: { index: 'asc' },
          select: { role: true },
        },
      },
    })
    expect(run.status).toBe(AgentRunStatus.running)
    expect(run.error).toBeNull()
    expect(run.messages.map((m) => m.role)).toEqual([
      AgentMessageRole.user,
      AgentMessageRole.assistant,
      AgentMessageRole.tool,
      AgentMessageRole.assistant,
      AgentMessageRole.tool,
    ])
  })
})

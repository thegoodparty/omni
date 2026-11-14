import { Injectable, NotFoundException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { JudgeReplaySchema } from '@goodparty_org/contracts'
import type { ModelMessage } from 'ai'
import { z } from 'zod'
import {
  AgentRunStatus,
  ChatMessageRole,
  ChatScope,
  type ChatConversation,
  type Prisma,
} from '../../generated/prisma'
import { JobShutdownError, JobsService } from '@/jobs/jobs.service'
import type { JobRun } from '@/jobs/jobs.registry'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { loadAgentPrompt } from '../agentPrompt'
import { AGENTS, isAgentName } from '../agents.registry'
import {
  withAgentRun,
  withInvokeAgentSpan,
} from '../observability/agentRunSpans'
import { AgentWebService } from '../tools/agentWeb.service'
import { AgentPageReplayService, type JudgeReplay } from '../tools/judgeReplay'
import type { AgentRuntime, BackgroundAgentDefinition, RunView } from '../types'
import { AgentModels } from './agentModels'
import {
  FINISH_INSTRUCTIONS,
  runAgentLoop,
  RunStoppedError,
  type SavedStep,
  SavedStepSchema,
  type StepUsage,
  StepUsageSchema,
} from './aiSdkLoop'
import { agentShapeHash } from './shapeHash'

export type AgentRunJobData = { runId: string }

// A run stamped by a task that booted after this one was stamped by newer
// code (deploys roll forward), so this task hands it back instead of
// restarting it under an older shape.
const TASK_BOOTED_AT = new Date()

const MAX_STEPS_PER_RUN = 120
const MAX_NUDGES_PER_RUN = 5
const TERMINAL: AgentRunStatus[] = [
  AgentRunStatus.completed,
  AgentRunStatus.failed,
  AgentRunStatus.superseded,
]

// List prices per million tokens; web search is $10 per 1,000 searches.
const RATES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-sonnet-4-6': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
}
const WEB_SEARCH_USD = 0.01

const StoredReplaySchema = z.object({
  replay: JudgeReplaySchema,
  issuedAt: z.number().int(),
})
const OrganizationInputSchema = z.object({
  organizationSlug: z.string().min(1),
})
const SavedUsageSchema = z.object({ usage: StepUsageSchema })

const toJson = (value: unknown): Prisma.InputJsonValue => {
  const json: unknown = JSON.parse(JSON.stringify(value))
  if (json === null || typeof json !== 'object') {
    throw new Error('agent run state must be a JSON object or array')
  }
  return json as Prisma.InputJsonValue
}

const stepCostUsd = (
  model: string | null,
  usage: StepUsage,
): number | undefined => {
  const rates = model ? RATES[model] : undefined
  if (!rates) return undefined
  const uncached =
    usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens
  return (
    (uncached * rates.input +
      usage.cacheReadTokens * rates.cacheRead +
      usage.cacheWriteTokens * rates.cacheWrite +
      usage.outputTokens * rates.output) /
      1_000_000 +
    usage.webSearches * WEB_SEARCH_USD
  )
}

// A fresh run row: the conversation opens with the input as its first
// user message.
const newRunData = (args: {
  agent: string
  organizationSlug: string | null
  input: Prisma.InputJsonValue
  shapeHash: string
  judgeReplay?: Prisma.InputJsonValue
}): Prisma.ChatConversationCreateInput => ({
  scope: ChatScope.background_agent,
  organizationSlug: args.organizationSlug,
  title: args.agent,
  agentName: args.agent,
  status: AgentRunStatus.queued,
  shapeHash: args.shapeHash,
  shapeStampedAt: TASK_BOOTED_AT,
  runInput: args.input,
  ...(args.judgeReplay !== undefined && { judgeReplay: args.judgeReplay }),
  messages: {
    create: {
      role: ChatMessageRole.user,
      content: JSON.stringify(args.input, null, 2),
    },
  },
})

const definitionOf = (
  agent: string | null,
): BackgroundAgentDefinition<z.ZodType, z.ZodType> => {
  if (!agent || !isAgentName(agent)) {
    throw new NotFoundException(`no agent named ${agent ?? '(none)'}`)
  }
  return AGENTS[agent]
}

// The AI SDK engine. A background run is one ChatConversation (scope
// background_agent, no user), each model step a ChatMessage carrying the
// step's messages, tool results included. The pg-boss job agentRun works a
// run; a retry loads the saved steps and calls the loop again.
// src/agents/POC.md.
@Injectable()
export class AiSdkAgentRuntime
  extends createPrismaBase(MODELS.ChatConversation)
  implements AgentRuntime
{
  constructor(
    private readonly jobs: JobsService,
    private readonly moduleRef: ModuleRef,
    private readonly models: AgentModels,
    private readonly web: AgentWebService,
    private readonly replay: AgentPageReplayService,
  ) {
    super()
  }

  async run(
    agent: string,
    input: unknown,
    options?: { judgeReplay?: JudgeReplay },
  ): Promise<{ runId: string }> {
    const definition = definitionOf(agent)
    const parsed: unknown = definition.input.parse(input)
    const { organizationSlug } = OrganizationInputSchema.parse(parsed)
    const runId = await this.client.$transaction(async (tx) => {
      const row = await tx.chatConversation.create({
        data: newRunData({
          agent,
          organizationSlug,
          input: toJson(parsed),
          shapeHash: agentShapeHash(definition.output),
          ...(options?.judgeReplay && {
            judgeReplay: toJson({
              replay: options.judgeReplay,
              issuedAt: Math.floor(Date.now() / 1000),
            }),
          }),
        }),
        select: { id: true },
      })
      await this.jobs.send('agentRun', { runId: row.id }, { tx })
      return row.id
    })
    return { runId }
  }

  async getRun(runId: string): Promise<RunView> {
    const run = await this.model.findUnique({
      where: { id: runId },
      include: {
        messages: {
          where: { role: ChatMessageRole.assistant },
          select: { model: true, step: true },
        },
      },
    })
    if (!run || run.scope !== ChatScope.background_agent) {
      throw new NotFoundException(`no agent run ${runId}`)
    }

    let costUsd: number | undefined = 0
    for (const message of run.messages) {
      const saved = SavedUsageSchema.safeParse(message.step)
      if (!saved.success) continue
      const cost = stepCostUsd(message.model, saved.data.usage)
      costUsd =
        cost === undefined || costUsd === undefined ? undefined : costUsd + cost
    }

    return {
      runId: run.id,
      agent: run.agentName ?? '',
      status: run.status ?? AgentRunStatus.queued,
      shapeHash: run.shapeHash ?? '',
      steps: run.messages.length,
      ...(run.supersededByRunId !== null && {
        supersededBy: run.supersededByRunId,
      }),
      ...(run.runOutput !== null && { artifact: run.runOutput }),
      ...(costUsd !== undefined && { costUsd }),
      ...(run.runError !== null && { error: run.runError }),
    }
  }

  // The agentRun worker.
  async execute(job: JobRun<AgentRunJobData>): Promise<void> {
    const run = await this.model.findUnique({ where: { id: job.data.runId } })
    if (!run || (run.status && TERMINAL.includes(run.status))) return
    const definition = definitionOf(run.agentName)
    const agent = run.agentName ?? ''
    const shapeHash = agentShapeHash(definition.output)

    if (run.shapeHash !== shapeHash) {
      if (run.shapeStampedAt && run.shapeStampedAt > TASK_BOOTED_AT) {
        throw new Error(
          `agent run ${run.id} was started by newer code (shape ${run.shapeHash}, this task has ${shapeHash}); handing it back`,
        )
      }
      await this.supersede(run, shapeHash)
      return
    }

    await this.model.update({
      where: { id: run.id },
      data: { status: AgentRunStatus.running },
    })

    const stored = StoredReplaySchema.safeParse(run.judgeReplay)
    if (stored.success) {
      this.replay.bind(run.id, stored.data.replay, stored.data.issuedAt)
    }

    // Tools and model calls stop when pg-boss times the attempt out. A
    // deploy only asks the run to stop after its current step.
    const timedOut = new AbortController()
    job.signal.addEventListener('abort', () => {
      if (!(job.signal.reason instanceof JobShutdownError)) {
        timedOut.abort(job.signal.reason)
      }
    })

    try {
      await withAgentRun({ runId: run.id, agent, shapeHash }, () =>
        withInvokeAgentSpan(
          { name: agent, model: definition.model, provider: 'anthropic' },
          () =>
            this.runLoop(run, definition, {
              stopRequested: () =>
                job.signal.aborted &&
                job.signal.reason instanceof JobShutdownError,
              abortSignal: timedOut.signal,
            }),
        ),
      )
    } catch (err) {
      const lastAttempt = job.retryCount >= job.retryLimit
      if (lastAttempt && !(err instanceof RunStoppedError)) {
        await this.model.update({
          where: { id: run.id },
          data: {
            status: AgentRunStatus.failed,
            runError: err instanceof Error ? err.message : String(err),
          },
        })
      }
      throw err
    } finally {
      this.replay.release(run.id)
      await this.web.endRun(run.id)
    }
  }

  // The saved steps were taken under another output schema, so they are
  // left on this row (still measurable) and a fresh run starts in its place.
  private async supersede(
    run: ChatConversation,
    shapeHash: string,
  ): Promise<void> {
    const freshId = await this.client.$transaction(async (tx) => {
      const fresh = await tx.chatConversation.create({
        data: newRunData({
          agent: run.agentName ?? '',
          organizationSlug: run.organizationSlug,
          input: toJson(run.runInput),
          shapeHash,
          ...(run.judgeReplay !== null && {
            judgeReplay: toJson(run.judgeReplay),
          }),
        }),
        select: { id: true },
      })
      await tx.chatConversation.update({
        where: { id: run.id },
        data: {
          status: AgentRunStatus.superseded,
          supersededByRunId: fresh.id,
        },
      })
      await this.jobs.send('agentRun', { runId: fresh.id }, { tx })
      return fresh.id
    })
    this.logger.info(
      { runId: run.id, supersededBy: freshId, shapeHash },
      'agent run shape changed; started a fresh run',
    )
  }

  private async runLoop(
    run: ChatConversation,
    definition: BackgroundAgentDefinition<z.ZodType, z.ZodType>,
    control: { stopRequested: () => boolean; abortSignal: AbortSignal },
  ): Promise<void> {
    const rows = await this.client.chatMessage.findMany({
      where: { conversationId: run.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const messages: ModelMessage[] = []
    let savedSteps = 0
    for (const row of rows) {
      if (row.role === ChatMessageRole.user) {
        messages.push({ role: 'user', content: row.content })
        continue
      }
      messages.push(...SavedStepSchema.parse(row.step).messages)
      savedSteps++
    }

    const output = await runAgentLoop({
      agentName: run.agentName ?? '',
      model: this.models.languageModel(definition.model),
      system: loadAgentPrompt(definition.prompt) + FINISH_INSTRUCTIONS,
      messages,
      tools: definition.tools,
      output: definition.output,
      toolContext: {
        runId: run.id,
        organizationSlug: run.organizationSlug ?? '',
        signal: control.abortSignal,
        moduleRef: this.moduleRef,
      },
      savedSteps,
      maxSteps: MAX_STEPS_PER_RUN,
      maxNudges: MAX_NUDGES_PER_RUN,
      stopRequested: control.stopRequested,
      abortSignal: control.abortSignal,
      saveStep: async (step: SavedStep, text: string) => {
        await this.client.chatMessage.create({
          data: {
            conversationId: run.id,
            role: ChatMessageRole.assistant,
            content: text,
            model: definition.model,
            inputTokens: step.usage.inputTokens,
            outputTokens: step.usage.outputTokens,
            step: toJson(step),
          },
        })
      },
      saveNudge: async (text: string) => {
        await this.client.chatMessage.create({
          data: {
            conversationId: run.id,
            role: ChatMessageRole.user,
            content: text,
          },
        })
      },
    })

    await definition.onArtifact(
      output,
      { runId: run.id, input: run.runInput },
      this.moduleRef,
    )
    await this.model.update({
      where: { id: run.id },
      data: { status: AgentRunStatus.completed, runOutput: toJson(output) },
    })
  }
}

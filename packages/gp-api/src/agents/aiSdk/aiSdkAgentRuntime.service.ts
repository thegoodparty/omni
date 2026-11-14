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
import { withAgentRun, withStageSpan } from '../observability/agentRunSpans'
import { AgentWebService } from '../tools/agentWeb.service'
import { AgentPageReplayService, type JudgeReplay } from '../tools/judgeReplay'
import {
  type AgentRuntime,
  type BackgroundAgentDefinition,
  END,
  type RunView,
  type StageDefinition,
} from '../types'
import { AgentModels } from './agentModels'
import {
  FINISH_INSTRUCTIONS,
  runStageLoop,
  type SavedStep,
  SavedStepSchema,
  StageStoppedError,
  type StepUsage,
  StepUsageSchema,
} from './aiSdkStage'
import { agentShapeHash } from './shapeHash'

export type AgentRunJobData = { runId: string }

// A run stamped by a task that booted after this one was stamped by newer
// code (deploys roll forward), so this task hands it back instead of
// restarting it under an older shape.
const TASK_BOOTED_AT = new Date()

const MAX_STEPS_PER_STAGE = 60
const MAX_NUDGES_PER_STAGE = 5
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
const OrganizationInputSchema = z.object({ organizationSlug: z.string().min(1) })
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

const nextStage = (
  stage: StageDefinition,
  state: Record<string, unknown>,
): string =>
  typeof stage.next === 'function' ? stage.next(state) : (stage.next ?? END)

const definitionOf = (
  agent: string | null,
): BackgroundAgentDefinition<z.ZodType, z.ZodType> => {
  if (!agent || !isAgentName(agent)) {
    throw new NotFoundException(`no agent named ${agent ?? '(none)'}`)
  }
  return AGENTS[agent]
}

// The AI SDK engine. A background run is a ChatConversation (scope
// background_agent, no user), each stage a child conversation, each model
// step a ChatMessage carrying the step's messages, tool results included.
// The pg-boss job agentRun works a run; a retry picks up from the last saved
// step. src/agents/POC.md.
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
        data: {
          scope: ChatScope.background_agent,
          organizationSlug,
          title: agent,
          agentName: agent,
          status: AgentRunStatus.queued,
          shapeHash: agentShapeHash(definition.stages),
          shapeStampedAt: TASK_BOOTED_AT,
          runInput: toJson(parsed),
          ...(options?.judgeReplay && {
            judgeReplay: toJson({
              replay: options.judgeReplay,
              issuedAt: Math.floor(Date.now() / 1000),
            }),
          }),
        },
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
        stageRuns: {
          orderBy: { createdAt: 'asc' },
          include: {
            messages: {
              where: { role: ChatMessageRole.assistant },
              select: { model: true, step: true },
            },
          },
        },
      },
    })
    if (!run || run.scope !== ChatScope.background_agent || run.parentRunId) {
      throw new NotFoundException(`no agent run ${runId}`)
    }
    const stageNames = isAgentName(run.agentName ?? '')
      ? Object.keys(definitionOf(run.agentName).stages)
      : []
    const live = run.stageRuns.filter(
      (s) => s.status !== AgentRunStatus.superseded,
    )
    for (const s of live) {
      if (s.agentName && !stageNames.includes(s.agentName)) {
        stageNames.push(s.agentName)
      }
    }

    let costUsd: number | undefined = 0
    for (const stage of run.stageRuns) {
      for (const message of stage.messages) {
        const saved = SavedUsageSchema.safeParse(message.step)
        if (!saved.success) continue
        const cost = stepCostUsd(message.model, saved.data.usage)
        costUsd = cost === undefined || costUsd === undefined ? undefined : costUsd + cost
      }
    }

    return {
      runId: run.id,
      agent: run.agentName ?? '',
      status: run.status ?? AgentRunStatus.queued,
      shapeHash: run.shapeHash ?? '',
      stages: stageNames.map((name) => {
        const stage = live.find((s) => s.agentName === name)
        if (!stage) {
          return {
            name,
            status:
              run.status === AgentRunStatus.completed ? 'skipped' : 'pending',
            steps: 0,
          }
        }
        return {
          name,
          status: stage.status ?? AgentRunStatus.running,
          steps: stage.messages.length,
          ...(stage.runOutput !== null && { output: stage.runOutput }),
        }
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
    const shapeHash = agentShapeHash(definition.stages)

    if (run.shapeHash !== shapeHash) {
      if (run.shapeStampedAt && run.shapeStampedAt > TASK_BOOTED_AT) {
        throw new Error(
          `agent run ${run.id} was started by newer code (shape ${run.shapeHash}, this task has ${shapeHash}); handing it back`,
        )
      }
      await this.startOver(run.id, shapeHash)
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
        this.runStages(run, definition, shapeHash, {
          stopRequested: () => job.signal.aborted,
          abortSignal: timedOut.signal,
        }),
      )
    } catch (err) {
      const lastAttempt = job.retryCount >= job.retryLimit
      if (lastAttempt && !(err instanceof StageStoppedError)) {
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

  private async startOver(runId: string, shapeHash: string): Promise<void> {
    await this.client.$transaction([
      this.model.updateMany({
        where: {
          parentRunId: runId,
          status: { not: AgentRunStatus.superseded },
        },
        data: { status: AgentRunStatus.superseded },
      }),
      this.model.update({
        where: { id: runId },
        data: { shapeHash, shapeStampedAt: TASK_BOOTED_AT },
      }),
    ])
    this.logger.info({ runId, shapeHash }, 'agent run shape changed; starting over')
  }

  private async runStages(
    run: ChatConversation,
    definition: BackgroundAgentDefinition<z.ZodType, z.ZodType>,
    shapeHash: string,
    control: { stopRequested: () => boolean; abortSignal: AbortSignal },
  ): Promise<void> {
    const stageRows = await this.model.findMany({
      where: {
        parentRunId: run.id,
        status: { not: AgentRunStatus.superseded },
      },
    })
    const state: Record<string, unknown> = { input: run.runInput }
    let current = Object.keys(definition.stages)[0] ?? END
    let last: unknown
    while (current !== END) {
      const stage = definition.stages[current]
      if (!stage) throw new Error(`agent run ${run.id}: no stage ${current}`)
      const row = stageRows.find((s) => s.agentName === current)
      const output =
        row?.status === AgentRunStatus.completed
          ? stage.output.parse(row.runOutput)
          : await withStageSpan(
              { name: current, model: stage.model, provider: 'anthropic' },
              () =>
                this.runStage(run, current, stage, state, shapeHash, row, control),
            )
      state[current] = output
      last = output
      current = nextStage(stage, state)
    }

    await definition.onArtifact(
      last,
      { runId: run.id, input: run.runInput },
      this.moduleRef,
    )
    await this.model.update({
      where: { id: run.id },
      data: { status: AgentRunStatus.completed, runOutput: toJson(last) },
    })
  }

  private async runStage(
    run: ChatConversation,
    stageName: string,
    stage: StageDefinition,
    state: Record<string, unknown>,
    shapeHash: string,
    existing: ChatConversation | undefined,
    control: { stopRequested: () => boolean; abortSignal: AbortSignal },
  ): Promise<unknown> {
    const reads = Object.fromEntries(
      stage.reads.map((name) => [name, state[name]]),
    )
    const stageRow =
      existing ??
      (await this.model.create({
        data: {
          scope: ChatScope.background_agent,
          organizationSlug: run.organizationSlug,
          title: stageName,
          agentName: stageName,
          parentRunId: run.id,
          status: AgentRunStatus.running,
          shapeHash,
          runInput: toJson(reads),
          messages: {
            create: {
              role: ChatMessageRole.user,
              content: JSON.stringify(reads, null, 2),
            },
          },
        },
      }))

    const rows = await this.client.chatMessage.findMany({
      where: { conversationId: stageRow.id },
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

    const output = await runStageLoop({
      stageName,
      model: this.models.languageModel(stage.model),
      system: loadAgentPrompt(stage.prompt) + FINISH_INSTRUCTIONS,
      messages,
      tools: stage.tools,
      output: stage.output,
      toolContext: {
        runId: run.id,
        organizationSlug: run.organizationSlug ?? '',
        signal: control.abortSignal,
        moduleRef: this.moduleRef,
      },
      savedSteps,
      maxSteps: MAX_STEPS_PER_STAGE,
      maxNudges: MAX_NUDGES_PER_STAGE,
      stopRequested: control.stopRequested,
      abortSignal: control.abortSignal,
      saveStep: async (step: SavedStep, text: string) => {
        await this.client.chatMessage.create({
          data: {
            conversationId: stageRow.id,
            role: ChatMessageRole.assistant,
            content: text,
            model: stage.model,
            inputTokens: step.usage.inputTokens,
            outputTokens: step.usage.outputTokens,
            step: toJson(step),
          },
        })
      },
      saveNudge: async (text: string) => {
        await this.client.chatMessage.create({
          data: {
            conversationId: stageRow.id,
            role: ChatMessageRole.user,
            content: text,
          },
        })
      },
    })

    await this.model.update({
      where: { id: stageRow.id },
      data: { status: AgentRunStatus.completed, runOutput: toJson(output) },
    })
    return output
  }
}

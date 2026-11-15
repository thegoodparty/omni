import { Injectable, NotFoundException } from '@nestjs/common'
import type { ModelMessage } from 'ai'
import { z } from 'zod'
import {
  ChatMessageRole,
  ChatScope,
  type ExperimentRun,
  ExperimentRunStatus,
  type Prisma,
} from '@/generated/prisma'
import type { JobRun, WorkerContext } from '@/jobs/jobs.registry'
import { JobShutdownError, JobsService } from '@/jobs/jobs.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { AgentModels } from './agentModels'
import { withAgentRunSpan } from './agentRunSpans'
import { AGENTS } from './agents.registry'
import {
  FINISH_INSTRUCTIONS,
  runAgentLoop,
  RunStoppedError,
  type SavedStep,
  SavedStepSchema,
  StepUsageSchema,
} from './aiSdkLoop'
import type { AgentDefinition } from './defineAgent'
import { stepCostUsd } from './modelPricing'
import { agentShapeHash } from './shapeHash'

export type AgentRunJobData = { runId: string }

// The step budget of one run, across every attempt.
const MAX_STEPS_PER_RUN = 120
const MAX_NUDGES_PER_ATTEMPT = 5
// As AgentExperimentResultService truncates the PMF Engine's errors.
const MAX_ERROR_LENGTH = 1000
const TERMINAL: ExperimentRunStatus[] = [
  ExperimentRunStatus.COMPLETED,
  ExperimentRunStatus.FAILED,
  ExperimentRunStatus.SUPERSEDED,
]

const SavedUsageSchema = z.object({ usage: StepUsageSchema })

const definitionOf = (name: string): AgentDefinition => {
  const definition = AGENTS[name]
  if (!definition) throw new NotFoundException(`no agent named ${name}`)
  return definition
}

// Agent inputs and steps are JSON by construction: the input schema parsed
// them, or the model produced them.
const toJson = (value: unknown): Prisma.InputJsonValue => {
  const json = z.json().parse(JSON.parse(JSON.stringify(value)))
  if (json === null) throw new Error('agent run state cannot be null')
  return json
}

// gp-api's own agents (src/agents/AGENTS.md). A run is an ExperimentRun,
// read by products and gp-admin as the PMF Engine's runs are, holding one
// ChatConversation whose ChatMessage rows are the run's completed steps.
// The agentRun job works a run; a retry loads the saved steps and calls the
// loop again.
@Injectable()
export class AgentsService extends createPrismaBase(MODELS.ExperimentRun) {
  constructor(
    private readonly jobs: JobsService,
    private readonly models: AgentModels,
  ) {
    super()
  }

  // The only way to start an agent.
  async run(name: string, input: unknown): Promise<{ runId: string }> {
    const definition = definitionOf(name)
    const parsed = definition.input.parse(input)
    const runId = await this.client.$transaction((tx) =>
      this.createRun(tx, {
        name,
        organizationSlug: parsed.organizationSlug,
        input: parsed,
        shapeHash: agentShapeHash(definition.output),
      }),
    )
    return { runId }
  }

  // The agentRun worker.
  async execute(
    job: JobRun<AgentRunJobData>,
    context: WorkerContext,
  ): Promise<void> {
    const run = await this.model.findUnique({
      where: { runId: job.data.runId },
      include: { conversation: { select: { id: true } } },
    })
    if (!run?.conversation || TERMINAL.includes(run.status)) return
    const conversationId = run.conversation.id
    const definition = definitionOf(run.experimentType)
    const shapeHash = agentShapeHash(definition.output)

    if (run.shapeHash !== shapeHash) {
      await this.supersede(run, conversationId, shapeHash)
      return
    }

    await this.model.update({
      where: { runId: run.runId },
      data: { status: ExperimentRunStatus.RUNNING },
    })

    // pg-boss timing the attempt out stops tools and model calls at once. A
    // deploy only asks the run to stop after its current step.
    const timedOut = new AbortController()
    job.signal.addEventListener('abort', () => {
      if (!(job.signal.reason instanceof JobShutdownError)) {
        timedOut.abort(job.signal.reason)
      }
    })

    try {
      const output = await withAgentRunSpan(
        {
          runId: run.runId,
          agent: run.experimentType,
          shapeHash,
          model: definition.model,
        },
        () =>
          this.runLoop(run, conversationId, definition, context, {
            stopRequested: () =>
              job.signal.aborted &&
              job.signal.reason instanceof JobShutdownError,
            abortSignal: timedOut.signal,
          }),
      )
      await definition.onArtifact(
        output,
        { runId: run.runId, input: definition.input.parse(run.params) },
        context,
      )
      await this.finish(run, conversationId, ExperimentRunStatus.COMPLETED)
    } catch (err) {
      const lastAttempt = job.retryCount >= job.retryLimit
      if (lastAttempt && !(err instanceof RunStoppedError)) {
        const message = err instanceof Error ? err.message : String(err)
        await this.finish(
          run,
          conversationId,
          ExperimentRunStatus.FAILED,
          message,
        )
      }
      throw err
    }
  }

  private async createRun(
    tx: Prisma.TransactionClient,
    args: {
      name: string
      organizationSlug: string
      input: unknown
      shapeHash: string
    },
  ): Promise<string> {
    const params = toJson(args.input)
    const { runId } = await tx.experimentRun.create({
      data: {
        experimentType: args.name,
        organizationSlug: args.organizationSlug,
        status: ExperimentRunStatus.QUEUED,
        params,
        shapeHash: args.shapeHash,
        conversation: {
          create: {
            scope: ChatScope.background_agent,
            organizationSlug: args.organizationSlug,
            title: args.name,
            messages: {
              create: {
                role: ChatMessageRole.user,
                content: JSON.stringify(params, null, 2),
              },
            },
          },
        },
      },
      select: { runId: true },
    })
    await this.jobs.send('agentRun', { runId }, { tx })
    return runId
  }

  // The saved steps were taken under another output schema, so they stay on
  // this run (still measurable) and a fresh run starts in its place.
  private async supersede(
    run: ExperimentRun,
    conversationId: string,
    shapeHash: string,
  ): Promise<void> {
    const costUsd = await this.costUsd(conversationId)
    const freshId = await this.client.$transaction(async (tx) => {
      await tx.experimentRun.update({
        where: { runId: run.runId },
        data: { status: ExperimentRunStatus.SUPERSEDED, costUsd },
      })
      return this.createRun(tx, {
        name: run.experimentType,
        organizationSlug: run.organizationSlug,
        input: run.params,
        shapeHash,
      })
    })
    this.logger.info(
      { runId: run.runId, supersededBy: freshId, shapeHash },
      'agent run shape changed; started a fresh run',
    )
  }

  private async finish(
    run: ExperimentRun,
    conversationId: string,
    status: ExperimentRunStatus,
    error?: string,
  ): Promise<void> {
    await this.model.update({
      where: { runId: run.runId },
      data: {
        status,
        costUsd: await this.costUsd(conversationId),
        durationSeconds: (Date.now() - run.createdAt.getTime()) / 1000,
        ...(error !== undefined && {
          error: error.slice(0, MAX_ERROR_LENGTH),
        }),
      },
    })
  }

  // Priced from each step's tokens; null when a step's model has no price.
  private async costUsd(conversationId: string): Promise<number | null> {
    const steps = await this.client.chatMessage.findMany({
      where: { conversationId, role: ChatMessageRole.assistant },
      select: { model: true, step: true },
    })
    let total = 0
    for (const step of steps) {
      const saved = SavedUsageSchema.safeParse(step.step)
      const cost =
        saved.success && step.model
          ? stepCostUsd(step.model, saved.data.usage)
          : null
      if (cost === null) return null
      total += cost
    }
    return total
  }

  private async runLoop(
    run: ExperimentRun,
    conversationId: string,
    definition: AgentDefinition,
    context: WorkerContext,
    control: { stopRequested: () => boolean; abortSignal: AbortSignal },
  ): Promise<unknown> {
    const rows = await this.client.chatMessage.findMany({
      where: { conversationId },
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

    return runAgentLoop({
      agentName: run.experimentType,
      model: this.models.languageModel(definition.model),
      system: definition.prompt + FINISH_INSTRUCTIONS,
      messages,
      tools: definition.tools,
      output: definition.output,
      toolContext: {
        runId: run.runId,
        organizationSlug: run.organizationSlug,
        signal: control.abortSignal,
        get: context.get,
      },
      savedSteps,
      maxSteps: MAX_STEPS_PER_RUN,
      maxNudges: MAX_NUDGES_PER_ATTEMPT,
      stopRequested: control.stopRequested,
      abortSignal: control.abortSignal,
      saveStep: async (step: SavedStep, text: string) => {
        await this.client.chatMessage.create({
          data: {
            conversationId,
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
          data: { conversationId, role: ChatMessageRole.user, content: text },
        })
      },
    })
  }
}

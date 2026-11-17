import { Injectable, NotFoundException } from '@nestjs/common'
import type { ModelMessage } from 'ai'
import { z } from 'zod'
import {
  AgentMessageRole,
  type AgentRun,
  AgentRunStatus,
  type Prisma,
} from '@/generated/prisma'
import type { JobRun, WorkerContext } from '@/jobs/jobs.registry'
import { JobShutdownError, JobsService } from '@/jobs/jobs.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { runInputRow, toModelMessages } from './agentMessages'
import { type AgentModel, AgentModels } from './agentModels'
import { withAgentRunSpan } from './agentRunSpans'
import { AGENTS } from './agents.registry'
import { FINISH_INSTRUCTIONS, runAgentLoop, RunStoppedError } from './aiSdkLoop'
import type { AgentDefinition } from './defineAgent'
import {
  type AgentManifest,
  agentManifest,
  manifestShapeHash,
} from './manifest'

export type AgentRunJobData = { runId: string }

// The step budget of one run, across every attempt.
const MAX_STEPS_PER_RUN = 120
const MAX_NUDGES_PER_ATTEMPT = 5
// As AgentExperimentResultService truncates the PMF Engine's errors.
const MAX_ERROR_LENGTH = 1000
const TERMINAL: AgentRunStatus[] = [
  AgentRunStatus.completed,
  AgentRunStatus.failed,
  AgentRunStatus.superseded,
]

const definitionOf = (name: string): AgentDefinition => {
  const definition = AGENTS[name]
  if (!definition) throw new NotFoundException(`no agent named ${name}`)
  return definition
}

// Agent inputs and message parts are JSON by construction: the input schema
// parsed them, or the model produced them.
const toJson = (value: unknown): Prisma.InputJsonValue => {
  const json = z.json().parse(JSON.parse(JSON.stringify(value)))
  if (json === null) throw new Error('agent run state cannot be null')
  return json
}

// gp-api's own agents (src/agents/AGENTS.md). A background run is an AgentRun
// whose AgentMessage rows are every message the run has written, chat and
// background sharing the one table. The agentRun job works a run; a retry loads
// the rows and calls the loop again.
@Injectable()
export class AgentsService extends createPrismaBase(MODELS.AgentRun) {
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
        manifest: agentManifest(definition),
      }),
    )
    return { runId }
  }

  // The agentRun worker.
  async execute(
    job: JobRun<AgentRunJobData>,
    context: WorkerContext,
  ): Promise<void> {
    const run = await this.model.findUnique({ where: { id: job.data.runId } })
    if (!run || TERMINAL.includes(run.status)) return

    // pg-boss timing the attempt out stops tools and model calls at once. A
    // deploy only asks the run to stop after its current step.
    const timedOut = new AbortController()
    job.signal.addEventListener('abort', () => {
      if (!(job.signal.reason instanceof JobShutdownError)) {
        timedOut.abort(job.signal.reason)
      }
    })

    try {
      const definition = definitionOf(run.agentName)
      const manifest = agentManifest(definition)
      const shapeHash = manifestShapeHash(manifest)
      if (run.shapeHash !== shapeHash) {
        await this.supersede(run, manifest)
        return
      }

      await this.model.update({
        where: { id: run.id },
        data: {
          status: AgentRunStatus.running,
          startedAt: run.startedAt ?? new Date(),
        },
      })
      const agentModel = this.models.resolve(definition.model)
      // An artifact on the run means an earlier attempt finished the loop and
      // died before onArtifact: the output is settled, so this attempt writes
      // it where the product reads it and never calls the model again.
      const output =
        run.artifact !== null
          ? run.artifact
          : await withAgentRunSpan(
              {
                runId: run.id,
                agent: run.agentName,
                shapeHash,
                model: agentModel.modelId,
                provider: agentModel.provider,
              },
              async () => {
                const loopOutput = await this.runLoop(
                  run,
                  definition,
                  agentModel,
                  context,
                  {
                    stopRequested: () =>
                      job.signal.aborted &&
                      job.signal.reason instanceof JobShutdownError,
                    abortSignal: timedOut.signal,
                  },
                )
                // Inside the span and before onArtifact, so a task that dies
                // in between finds it here and does not redo the loop.
                await this.model.update({
                  where: { id: run.id },
                  data: { artifact: toJson(loopOutput) },
                })
                return loopOutput
              },
            )
      await definition.onArtifact(
        output,
        { runId: run.id, input: definition.input.parse(run.input) },
        context,
      )
      await this.finish(run, AgentRunStatus.completed)
    } catch (err) {
      const lastAttempt = job.retryCount >= job.retryLimit
      if (lastAttempt && !(err instanceof RunStoppedError)) {
        const message = err instanceof Error ? err.message : String(err)
        await this.finish(run, AgentRunStatus.failed, message)
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
      manifest: AgentManifest
    },
  ): Promise<string> {
    const input = toJson(args.input)
    const { id } = await tx.agentRun.create({
      data: {
        agentName: args.name,
        organizationSlug: args.organizationSlug,
        status: AgentRunStatus.queued,
        manifest: toJson(args.manifest),
        shapeHash: manifestShapeHash(args.manifest),
        input,
        // The run's input is its first message, so a resume and onArtifact both
        // read it from one place.
        messages: { create: { ...runInputRow(input), index: 0 } },
      },
      select: { id: true },
    })
    await this.jobs.send('agentRun', { runId: id }, { tx })
    return id
  }

  // The saved rows were written under another manifest, so they stay on this
  // run (readable, and counted toward its tokens) and a fresh run starts in
  // their place from the same input.
  private async supersede(
    run: AgentRun,
    manifest: AgentManifest,
  ): Promise<void> {
    const shapeHash = manifestShapeHash(manifest)
    const freshId = await this.client.$transaction(async (tx) => {
      await tx.agentRun.update({
        where: { id: run.id },
        data: { status: AgentRunStatus.superseded, finishedAt: new Date() },
      })
      return this.createRun(tx, {
        name: run.agentName,
        organizationSlug: run.organizationSlug,
        input: run.input,
        manifest,
      })
    })
    this.logger.info(
      { runId: run.id, supersededBy: freshId, shapeHash },
      'agent run shape changed; started a fresh run',
    )
  }

  private async finish(
    run: AgentRun,
    status: AgentRunStatus,
    error?: string,
  ): Promise<void> {
    await this.model.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        ...(error !== undefined && {
          error: error.slice(0, MAX_ERROR_LENGTH),
        }),
      },
    })
  }

  private async runLoop(
    run: AgentRun,
    definition: AgentDefinition,
    agentModel: AgentModel,
    context: WorkerContext,
    control: { stopRequested: () => boolean; abortSignal: AbortSignal },
  ): Promise<unknown> {
    const rows = await this.client.agentMessage.findMany({
      where: { agentRunId: run.id },
      orderBy: { index: 'asc' },
    })
    const messages: ModelMessage[] = toModelMessages(rows)
    const savedSteps = rows.filter(
      (row) => row.role === AgentMessageRole.assistant,
    ).length

    return runAgentLoop({
      agentName: run.agentName,
      model: agentModel.model,
      modelId: agentModel.modelId,
      system: definition.prompt + FINISH_INSTRUCTIONS,
      messages,
      tools: definition.tools,
      output: definition.output,
      toolContext: {
        runId: run.id,
        organizationSlug: run.organizationSlug,
        signal: control.abortSignal,
        get: context.get,
      },
      savedSteps,
      maxSteps: MAX_STEPS_PER_RUN,
      maxNudges: MAX_NUDGES_PER_ATTEMPT,
      stopRequested: control.stopRequested,
      abortSignal: control.abortSignal,
      saveRows: async (newRows) => {
        // Read from the table, not counted in memory: rows a killed attempt
        // wrote are here, and a resume starts after them.
        const highest = await this.client.agentMessage.findFirst({
          where: { agentRunId: run.id },
          orderBy: { index: 'desc' },
          select: { index: true },
        })
        const start = (highest?.index ?? -1) + 1
        await this.client.agentMessage.createMany({
          data: newRows.map((row, offset) => ({
            agentRunId: run.id,
            index: start + offset,
            role: row.role,
            parts: toJson(row.parts),
            model: row.model ?? null,
            inputTokens: row.inputTokens ?? null,
            outputTokens: row.outputTokens ?? null,
            cacheReadTokens: row.cacheReadTokens ?? null,
            cacheWriteTokens: row.cacheWriteTokens ?? null,
          })),
        })
      },
    })
  }
}

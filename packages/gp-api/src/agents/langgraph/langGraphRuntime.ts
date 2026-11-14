import { Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage } from '@langchain/core/messages'
import {
  GraphRecursionError,
  isGraphDrained,
  RunControl,
} from '@langchain/langgraph'
import { z } from 'zod'
import {
  AgentRunStatus,
  type ChatConversation,
  ChatScope,
  Prisma,
} from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import type { JobRun } from '@/jobs/jobs.registry'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { AGENTS, isAgentName } from '../agents.registry'
import { withAgentRun } from '../observability/agentRunSpans'
import { AgentWebService } from '../tools/agentWeb.service'
import { AgentPageReplayService, type JudgeReplay } from '../tools/judgeReplay'
import type { AgentRuntime, RunView } from '../types'
import {
  LANGGRAPH_SCHEMA,
  LangGraphCheckpointer,
} from './langGraphCheckpointer'
import {
  type AgentDefinition,
  buildStageGraph,
  chatModelFor,
  shapeHash,
  stageField,
  stagePath,
  stageView,
} from './stageGraph'
import { usageCostUsd } from './modelPricing'

const TERMINAL = new Set<AgentRunStatus>([
  AgentRunStatus.completed,
  AgentRunStatus.failed,
  AgentRunStatus.superseded,
])

const StoredReplaySchema = z.object({
  replay: z.object({ mode: z.enum(['record', 'replay']), key: z.string() }),
  issuedAt: z.number(),
})

const StageSummarySchema = z.array(
  z.object({
    name: z.string(),
    status: z.string(),
    steps: z.number(),
    output: z.unknown().optional(),
  }),
)

const JsonValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.json()),
  z.record(z.string(), z.json()),
])

const toJson = (value: unknown): Prisma.InputJsonValue =>
  JsonValueSchema.parse(JSON.parse(JSON.stringify(value ?? {})))

const organizationSlugOf = (input: unknown): string | null =>
  typeof input === 'object' &&
  input !== null &&
  'organizationSlug' in input &&
  typeof input.organizationSlug === 'string'
    ? input.organizationSlug
    : null

type StageProgress = { steps: number; costUsd: number }

@Injectable()
export class LangGraphAgentRuntime
  extends createPrismaBase(MODELS.ChatConversation)
  implements AgentRuntime
{
  constructor(
    private readonly jobs: JobsService,
    private readonly moduleRef: ModuleRef,
    private readonly checkpointer: LangGraphCheckpointer,
    private readonly web: AgentWebService,
    private readonly replay: AgentPageReplayService,
  ) {
    super()
  }

  // Seam for tests, which swap in a scripted model.
  chatModel(model: string): BaseChatModel {
    return chatModelFor(model)
  }

  async run(
    agent: string,
    input: unknown,
    options?: { judgeReplay?: JudgeReplay },
  ): Promise<{ runId: string }> {
    const definition = this.definitionOf(agent)
    const parsed: unknown = definition.input.parse(input)
    const runId = await this.client.$transaction(async (tx) => {
      const row = await tx.chatConversation.create({
        data: {
          scope: ChatScope.background_agent,
          organizationSlug: organizationSlugOf(parsed),
          agent,
          agentInput: toJson(parsed),
          runStatus: AgentRunStatus.queued,
          shapeHash: shapeHash(definition),
          ...(options?.judgeReplay && {
            judgeReplay: toJson({
              replay: options.judgeReplay,
              issuedAt: Math.floor(Date.now() / 1000),
            }),
          }),
        },
      })
      await this.jobs.send('agentRun', { runId: row.id }, { tx })
      return row.id
    })
    return { runId }
  }

  async getRun(runId: string): Promise<RunView> {
    const row = await this.latestAttempt(runId)
    const definition = this.definitionOf(this.agentOf(row))
    const base = {
      runId: row.id,
      agent: this.agentOf(row),
      status: row.runStatus ?? AgentRunStatus.queued,
      shapeHash: row.shapeHash ?? '',
      ...(row.runError !== null && { error: row.runError }),
    }
    if (row.runStatus && TERMINAL.has(row.runStatus) && row.stageSummary) {
      const stages = StageSummarySchema.parse(row.stageSummary)
      const last = [...stages].reverse().find((s) => s.output !== undefined)
      return {
        ...base,
        stages,
        ...(row.runStatus === AgentRunStatus.completed &&
          last && { artifact: last.output }),
        ...(row.costUsd !== null && { costUsd: row.costUsd }),
      }
    }
    const live = await this.liveProgress(row, definition)
    return { ...base, stages: live.stages, costUsd: live.costUsd }
  }

  // The agentRun job. Resumes the run's thread from its last saved step,
  // or starts over on a fresh thread when the agent's shape changed.
  async work(job: JobRun<{ runId: string }>): Promise<void> {
    let row = await this.latestAttempt(job.data.runId)
    if (row.runStatus && TERMINAL.has(row.runStatus)) return
    const agent = this.agentOf(row)
    const definition = this.definitionOf(agent)
    const current = shapeHash(definition)
    if (row.shapeHash !== current) {
      if (await this.isOlderShape(agent, current, row.shapeHash)) {
        throw new Error(
          `run ${row.id} was stamped by newer code (shape ${row.shapeHash}, ` +
            `this task has ${current}); handing it back`,
        )
      }
      row = await this.startOver(row, definition, current)
    }
    await this.runAttempt(row, definition, job)
  }

  private async runAttempt(
    row: ChatConversation,
    definition: AgentDefinition,
    job: JobRun<{ runId: string }>,
  ): Promise<void> {
    const runId = row.id
    const agent = this.agentOf(row)
    const control = new RunControl()
    const drain = () => control.requestDrain('shutdown')
    job.signal.addEventListener('abort', drain, { once: true })
    if (job.signal.aborted) drain()

    const stored = StoredReplaySchema.safeParse(row.judgeReplay)
    if (stored.success) {
      this.replay.bind(runId, stored.data.replay, stored.data.issuedAt)
    }
    await this.model.update({
      where: { id: runId },
      data: { runStatus: AgentRunStatus.running },
    })

    const graph = buildStageGraph(definition, {
      checkpointer: this.checkpointer.saver,
      chatModel: (model) => this.chatModel(model),
      run: {
        runId,
        organizationSlug: row.organizationSlug ?? '',
        moduleRef: this.moduleRef,
        signal: job.signal,
      },
    })
    const config = {
      configurable: { thread_id: runId },
      durability: 'sync' as const,
      control,
    }

    try {
      const state: Record<string, unknown> = await withAgentRun(
        { runId, agent, shapeHash: row.shapeHash ?? '' },
        async () => {
          const saved = await this.checkpointer.saver.getTuple({
            configurable: { thread_id: runId },
          })
          return graph.invoke(saved ? null : { input: row.agentInput }, config)
        },
      )
      const path = stagePath(definition, state)
      const last = path.at(-1)
      if (!last) throw new Error(`run ${runId} finished with no stage output`)
      await definition.onArtifact(
        state[stageField(last)],
        { runId, input: row.agentInput },
        this.moduleRef,
      )
      const progress = await this.liveProgress(row, definition)
      await this.model.update({
        where: { id: runId },
        data: {
          runStatus: AgentRunStatus.completed,
          stageSummary: toJson(
            progress.stages.map((s) =>
              s.status === 'pending' ? { ...s, status: 'skipped' } : s,
            ),
          ),
          costUsd: progress.costUsd,
          runError: null,
        },
      })
      await this.checkpointer.saver.deleteThread(runId)
    } catch (err) {
      // A drain or a shutdown abort goes back to the queue without spending
      // an attempt (JobsService); the next attempt resumes the thread.
      if (isGraphDrained(err) || job.signal.aborted) throw err
      // A stage that hit its step limit is looping; a retry resumes it with
      // a fresh limit and pays for the same loop again.
      const runaway = err instanceof GraphRecursionError
      if (runaway || job.retryCount >= job.retryLimit) {
        const progress = await this.liveProgress(row, definition)
        await this.model.update({
          where: { id: runId },
          data: {
            runStatus: AgentRunStatus.failed,
            stageSummary: toJson(progress.stages),
            costUsd: progress.costUsd,
            runError: err instanceof Error ? err.message : String(err),
          },
        })
      }
      if (runaway) return
      throw err
    } finally {
      job.signal.removeEventListener('abort', drain)
      this.replay.release(runId)
      await this.web.endRun(runId)
    }
  }

  // The run's stages from its checkpoints: a stage with output in the
  // parent graph's state is completed; the one the graph runs next is
  // running. Steps are the model calls saved in the stage's own namespace.
  private async liveProgress(
    row: ChatConversation,
    definition: AgentDefinition,
  ): Promise<{ stages: RunView['stages']; costUsd: number }> {
    const parent = await this.checkpointer.saver.getTuple({
      configurable: { thread_id: row.id, checkpoint_ns: '' },
    })
    const values = parent?.checkpoint.channel_values ?? {}
    const next = new Set(this.dueStages(definition, values))
    const progress = await this.stageProgress(row.id, definition)
    const stages = Object.keys(definition.stages).map((name) => {
      const output = values[stageField(name)]
      const status =
        output !== undefined
          ? 'completed'
          : next.has(name) && row.runStatus === AgentRunStatus.running
            ? 'running'
            : 'pending'
      return {
        name,
        status,
        steps: progress.get(name)?.steps ?? 0,
        ...(output !== undefined && { output }),
      }
    })
    const costUsd = [...progress.values()].reduce(
      (sum, p) => sum + p.costUsd,
      0,
    )
    return { stages, costUsd }
  }

  // The stage the graph runs next: the first stage without output along
  // the route `next` takes from what is already saved.
  private dueStages(
    definition: AgentDefinition,
    values: Record<string, unknown>,
  ): string[] {
    const path = stagePath(definition, values)
    const names = Object.keys(definition.stages)
    if (path.length === 0) return names.slice(0, 1)
    const last = path.at(-1)
    const stage = last ? definition.stages[last] : undefined
    if (!stage || stage.next === undefined) return []
    const target =
      typeof stage.next === 'string'
        ? stage.next
        : stage.next(stageView(definition, values))
    return names.includes(target) ? [target] : []
  }

  private async stageProgress(
    threadId: string,
    definition: AgentDefinition,
  ): Promise<Map<string, StageProgress>> {
    const rows = await this.client.$queryRaw<{ checkpoint_ns: string }[]>(
      Prisma.sql`SELECT DISTINCT checkpoint_ns FROM ${Prisma.raw(
        `"${LANGGRAPH_SCHEMA}"."checkpoints"`,
      )} WHERE thread_id = ${threadId} AND checkpoint_ns <> ''`,
    )
    const progress = new Map<string, StageProgress>()
    for (const { checkpoint_ns } of rows) {
      if (checkpoint_ns.includes('|')) continue
      const [stage = ''] = checkpoint_ns.split(':')
      const model = definition.stages[stage]?.model ?? ''
      const tuple = await this.checkpointer.saver.getTuple({
        configurable: { thread_id: threadId, checkpoint_ns },
      })
      const messages = tuple?.checkpoint.channel_values.messages
      // A model call; not the closing message createAgent writes itself
      // after the structured-output call, which has neither.
      const models = (Array.isArray(messages) ? messages : []).filter(
        (m): m is AIMessage =>
          AIMessage.isInstance(m) &&
          ((m.tool_calls?.length ?? 0) > 0 || m.usage_metadata !== undefined),
      )
      const prior = progress.get(stage) ?? { steps: 0, costUsd: 0 }
      progress.set(stage, {
        steps: prior.steps + models.length,
        costUsd:
          prior.costUsd +
          models.reduce(
            (sum, m) => sum + usageCostUsd(model, m.usage_metadata),
            0,
          ),
      })
    }
    return progress
  }

  // Follows a run to its newest attempt: a shape change replaces an attempt
  // with a child row on a fresh thread.
  private async latestAttempt(runId: string): Promise<ChatConversation> {
    const first = await this.model.findUnique({ where: { id: runId } })
    if (!first || !first.agent) throw new Error(`no agent run ${runId}`)
    let row: ChatConversation = first
    for (;;) {
      const child: ChatConversation | null = await this.model.findUnique({
        where: { parentRunId: row.id },
      })
      if (!child) return row
      row = child
    }
  }

  // Deploy order from the runs themselves: the hash whose first run came
  // earlier belongs to the older code. A hash with no runs yet is this
  // task's own new code.
  private async isOlderShape(
    agent: string,
    ours: string,
    theirs: string | null,
  ): Promise<boolean> {
    const firstRunAt = async (hash: string | null) =>
      hash === null
        ? null
        : ((
            await this.model.findFirst({
              where: { agent, shapeHash: hash },
              orderBy: { createdAt: 'asc' },
              select: { createdAt: true },
            })
          )?.createdAt ?? null)
    const [oursAt, theirsAt] = await Promise.all([
      firstRunAt(ours),
      firstRunAt(theirs),
    ])
    return oursAt !== null && theirsAt !== null && oursAt < theirsAt
  }

  private async startOver(
    row: ChatConversation,
    definition: AgentDefinition,
    hash: string,
  ): Promise<ChatConversation> {
    // Read before the old thread is deleted: what the replaced attempt did
    // and cost stays on its row.
    const progress = await this.liveProgress(row, definition)
    const child = await this.client.$transaction(async (tx) => {
      await tx.chatConversation.update({
        where: { id: row.id },
        data: {
          runStatus: AgentRunStatus.superseded,
          stageSummary: toJson(progress.stages),
          costUsd: progress.costUsd,
        },
      })
      return tx.chatConversation.create({
        data: {
          scope: ChatScope.background_agent,
          organizationSlug: row.organizationSlug,
          agent: row.agent,
          agentInput: toJson(row.agentInput),
          runStatus: AgentRunStatus.queued,
          shapeHash: hash,
          parentRunId: row.id,
          ...(row.judgeReplay !== null && {
            judgeReplay: toJson(row.judgeReplay),
          }),
        },
      })
    })
    this.logger.info(
      { runId: row.id, newRunId: child.id, from: row.shapeHash, to: hash },
      'agent shape changed; starting the run over on a fresh thread',
    )
    await this.checkpointer.saver.deleteThread(row.id)
    return child
  }

  private agentOf(row: ChatConversation): string {
    if (!row.agent) throw new Error(`${row.id} is not an agent run`)
    return row.agent
  }

  private definitionOf(agent: string): AgentDefinition {
    if (!isAgentName(agent)) throw new Error(`no agent named ${agent}`)
    return AGENTS[agent]
  }
}

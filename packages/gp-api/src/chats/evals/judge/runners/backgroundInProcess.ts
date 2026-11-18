import { createHash } from 'node:crypto'
import type { JudgeReplay } from '@goodparty_org/contracts'
import type { ModelMessage } from 'ai'
import { differenceInMilliseconds } from 'date-fns'
import { z } from 'zod'
import { toModelMessages } from '@/agents/agentMessages'
import { AGENTS } from '@/agents/agents.registry'
import { submittedOutput } from '@/agents/aiSdkLoop'
import { agentManifest, manifestShapeHash } from '@/agents/manifest'
import type { AgentRunReplay } from '@/agents/tools/judgeReplay'
import {
  trendingIssuesArtifact,
  TrendingIssuesInputSchema,
  TrendingIssuesOutputSchema,
} from '@/communityIssues/trendingIssuesAgent/trendingIssues.schema'
import {
  AgentMessageRole,
  AgentRunStatus,
  type PrismaClient,
} from '@/generated/prisma'
import { PRICING_VERSION } from '../pricing'
import {
  isoUtc,
  RunRecordSchema,
  type Arm,
  type JsonValue,
  type RunRecord,
  type TokenUsage,
  type TraceStep,
  type Variant,
} from '../record'
import {
  type BackgroundCase,
  captureCostUsd,
  ciContext,
  type Clock,
  judgeRunId,
  JUDGE_SPEND_ENV,
} from './background'

// THE CANDIDATE ARM FOR AN AGENT THAT HAS MOVED ONTO gp-api's OWN AGENTS
// (src/agents). The base arm stays the PMF Engine's Fargate dispatch; this one
// starts the agent through AgentsService.run in the arm's own app, waits for
// its AgentRun to end, and builds the same record shape from the run's
// AgentMessage rows, so everything above a runner reads both arms alike.

// Judge agent id (also the gp-api agent's name) -> how a case's params become
// the agent's input, and how its output becomes the artifact the PMF Engine
// would have published.
export interface InProcessAgent {
  input: (params: Record<string, JsonValue>, today: string) => unknown
  artifact: (
    output: unknown,
    run: { runId: string; organizationSlug: string },
  ) => unknown
}

const TrendingIssuesParamsSchema = z.object({
  organization_slug: z.string(),
  state: z.string(),
  office: z.string(),
  district_descriptor: z.string(),
})

export const IN_PROCESS_AGENTS: Partial<Record<string, InProcessAgent>> = {
  trending_issues: {
    input: (params, today) => {
      const parsed = TrendingIssuesParamsSchema.parse(params)
      return TrendingIssuesInputSchema.parse({
        organizationSlug: parsed.organization_slug,
        state: parsed.state,
        office: parsed.office,
        districtDescriptor: parsed.district_descriptor,
        today,
      })
    },
    artifact: (output, run) =>
      trendingIssuesArtifact(TrendingIssuesOutputSchema.parse(output), run),
  },
}

// The judge records the output and the product never sees it, as on the
// base arm, whose judge dispatches write nothing either. Without this, one
// case's onArtifact would rewrite the issue feed the next case reads first.
export const recordOnly = (agentId: string): void => {
  const definition = AGENTS[agentId]
  if (definition) {
    AGENTS[agentId] = { ...definition, onArtifact: async () => undefined }
  }
}

// One AgentMessage row as the runner reads it: the AI SDK's content, and the
// four token counts an assistant row carries.
export interface InProcessMessage {
  role: AgentMessageRole
  parts: unknown
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
}

export interface InProcessRunView {
  status: AgentRunStatus
  error: string | null
  organizationSlug: string
  messages: InProcessMessage[]
}

export interface InProcessRunnerDeps {
  start: (
    name: string,
    input: unknown,
    judgeReplay: AgentRunReplay | undefined,
  ) => Promise<{ runId: string }>
  readRun: (runId: string) => Promise<InProcessRunView>
  clock: Clock
}

export const prismaRunReader =
  (prisma: PrismaClient): InProcessRunnerDeps['readRun'] =>
  async (runId) => {
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: runId },
      include: { messages: { orderBy: { index: 'asc' } } },
    })
    return {
      status: run.status,
      error: run.error,
      organizationSlug: run.organizationSlug,
      messages: run.messages.map((message) => ({
        role: message.role,
        parts: message.parts,
        inputTokens: message.inputTokens,
        outputTokens: message.outputTokens,
        cacheReadTokens: message.cacheReadTokens,
        cacheWriteTokens: message.cacheWriteTokens,
      })),
    }
  }

export interface InProcessRunInput {
  sweepId: string
  agentId: string
  arm: Arm
  attempt: number
  agentCase: BackgroundCase
  variant: Omit<Variant, 'configDigest' | 'model'>
  replay?: JudgeReplay
  poll: { timeoutMs: number; intervalMs: number }
  dataVersion?: string
  env?: NodeJS.ProcessEnv
}

const TERMINAL = new Set<AgentRunStatus>([
  AgentRunStatus.completed,
  AgentRunStatus.failed,
  AgentRunStatus.superseded,
])

const ToolCallPartSchema = z.object({
  type: z.literal('tool-call'),
  toolCallId: z.string(),
  toolName: z.string(),
})

const ToolErrorPartSchema = z.object({
  type: z.literal('tool-result'),
  toolCallId: z.string(),
  output: z.object({
    type: z.enum(['error-text', 'error-json']),
    value: z.unknown(),
  }),
})

// What the agent reads: its prompt, model, tools and output schema. The role
// the manifest-plus-instruction digest plays on the base arm. The manifest
// half is the run's own shapeHash, so this digest and core's agree on when a
// shape changed.
export const inProcessConfigDigest = (agentId: string): string => {
  const agent = AGENTS[agentId]
  if (!agent) throw new Error(`no gp-api agent named ${agentId}`)
  return createHash('sha256')
    .update(agent.model)
    .update(Object.keys(agent.tools).join(','))
    .update(agent.prompt)
    .update(manifestShapeHash(agentManifest(agent)))
    .digest('hex')
}

const errorText = (value: unknown): string =>
  (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 500) ||
  'tool error'

// One trace step per model reply with no tool call, and one per tool call,
// with the tool's error on its step.
const traceOf = (
  messages: ModelMessage[],
): { trace: TraceStep[]; toolCalls: number; liveWeb: boolean } => {
  const trace: TraceStep[] = []
  const byCall = new Map<string, number>()
  let toolCalls = 0
  let liveWeb = false
  for (const message of messages) {
    if (typeof message.content === 'string') continue
    let calledTool = false
    for (const part of message.content) {
      const call = ToolCallPartSchema.safeParse(part)
      if (call.success) {
        calledTool = true
        toolCalls++
        if (call.data.toolName === 'webSearch') liveWeb = true
        byCall.set(call.data.toolCallId, trace.length)
        trace.push({
          index: trace.length,
          kind: 'tool',
          tool: call.data.toolName,
        })
      }
      const failed = ToolErrorPartSchema.safeParse(part)
      const at = failed.success ? byCall.get(failed.data.toolCallId) : undefined
      const step = at === undefined ? undefined : trace[at]
      if (failed.success && step)
        step.error = errorText(failed.data.output.value)
    }
    if (message.role === 'assistant' && !calledTool) {
      trace.push({ index: trace.length, kind: 'text' })
    }
  }
  return { trace, toolCalls, liveWeb }
}

// The record's `input` is uncached input only. Only assistant rows are a model
// call, so only they carry tokens.
const tokensOf = (messages: InProcessMessage[]): TokenUsage =>
  messages.reduce(
    (sum, message) =>
      message.role === AgentMessageRole.assistant
        ? {
            input:
              sum.input +
              (message.inputTokens ?? 0) -
              (message.cacheReadTokens ?? 0) -
              (message.cacheWriteTokens ?? 0),
            output: sum.output + (message.outputTokens ?? 0),
            cacheRead: sum.cacheRead + (message.cacheReadTokens ?? 0),
            cacheWrite: sum.cacheWrite + (message.cacheWriteTokens ?? 0),
          }
        : sum,
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  )

const modelMessages = (messages: InProcessMessage[]): ModelMessage[] =>
  toModelMessages(messages)

export const runInProcessBackgroundCase = async (
  deps: InProcessRunnerDeps,
  input: InProcessRunInput,
): Promise<RunRecord> => {
  const env = input.env ?? process.env
  if (env[JUDGE_SPEND_ENV] !== 'true') {
    throw new Error(
      `${JUDGE_SPEND_ENV} is not "true"; an in-process background run ` +
        'calls real models and has no canned reply',
    )
  }
  const agent = IN_PROCESS_AGENTS[input.agentId]
  const definition = AGENTS[input.agentId]
  if (!agent || !definition) {
    throw new Error(`${input.agentId} does not run in process`)
  }
  const runId = judgeRunId({
    sweepId: input.sweepId,
    agentId: input.agentId,
    caseId: input.agentCase.caseId,
    arm: input.arm,
    attempt: input.attempt,
  })
  const startedAt = deps.clock.now()

  const refusal =
    (input.agentCase.inputFiles ?? []).length > 0
      ? 'staged input files exist only on the Fargate runner'
      : (input.agentCase.seedPages ?? []).length > 0
        ? 'the in-process arm does not plant seeded pages'
        : undefined

  let view: InProcessRunView | undefined
  let agentRunId: string | undefined
  let failure = refusal
  if (failure === undefined) {
    const started = await deps.start(
      input.agentId,
      agent.input(input.agentCase.params, startedAt.toISOString().slice(0, 10)),
      input.replay && {
        replay: input.replay,
        judgeRunId: runId,
        issuedAt: Math.floor(startedAt.getTime() / 1000),
      },
    )
    agentRunId = started.runId
    const deadline = startedAt.getTime() + input.poll.timeoutMs
    for (;;) {
      view = await deps.readRun(agentRunId)
      if (TERMINAL.has(view.status)) break
      if (deps.clock.now().getTime() >= deadline) break
      await deps.clock.sleep(input.poll.intervalMs)
    }
    failure =
      view.status === AgentRunStatus.completed
        ? undefined
        : TERMINAL.has(view.status)
          ? `agent run ${agentRunId} ended ${view.status}` +
            (view.error ? `: ${view.error}` : '')
          : `agent run ${agentRunId} still ${view.status} after ` +
            `${input.poll.timeoutMs}ms`
  }
  const endedAt = deps.clock.now()

  const messages = view?.messages ?? []
  const submitted =
    failure === undefined
      ? submittedOutput(modelMessages(messages), definition.output)
      : { found: false as const }
  if (failure === undefined && !submitted.found) {
    failure = `agent run ${agentRunId} completed with no accepted submitOutput`
  }
  const artifact =
    submitted.found && agentRunId !== undefined && view
      ? agent.artifact(submitted.value, {
          runId: agentRunId,
          organizationSlug: view.organizationSlug,
        })
      : undefined

  const {
    trace: stepTrace,
    toolCalls,
    liveWeb,
  } = traceOf(modelMessages(messages))
  const tokens = tokensOf(messages)
  const cost = captureCostUsd(tokens, definition.model, undefined)
  const notes = [failure, cost.unmeasured].filter(
    (note): note is string => note !== undefined,
  )
  const trace = [
    ...stepTrace,
    ...notes.map((error, offset) => ({
      index: stepTrace.length + offset,
      kind: 'error' as const,
      error,
    })),
  ]
  const ci = ciContext(env)

  return RunRecordSchema.parse({
    schemaVersion: 1,
    sweepId: input.sweepId,
    runId,
    agentId: input.agentId,
    agentShape: 'background',
    arm: input.arm,
    variant: {
      ...input.variant,
      model: definition.model,
      configDigest: inProcessConfigDigest(input.agentId),
    },
    caseId: input.agentCase.caseId,
    attempt: input.attempt,
    startedAt: isoUtc(startedAt),
    endedAt: isoUtc(endedAt),
    input: {
      kind: 'params',
      value: {
        params: input.agentCase.params,
        inputFiles: (input.agentCase.inputFiles ?? []).map((file) => ({
          bucket: file.bucket,
          key: file.key,
          dest: file.dest,
        })),
      },
    },
    output:
      failure === undefined && artifact !== undefined
        ? { kind: 'artifact', value: artifact }
        : null,
    trace,
    telemetry: {
      latencyMs: differenceInMilliseconds(endedAt, startedAt),
      tokens,
      cost: { usdAtCapture: cost.usd, pricingVersion: PRICING_VERSION },
      toolCalls,
      toolErrors: stepTrace.filter((step) => step.error !== undefined).length,
      retries: 0,
    },
    toolQueries: [],
    ...(input.dataVersion !== undefined && { dataVersion: input.dataVersion }),
    liveWeb,
    ...(input.replay !== undefined && { pageReplay: input.replay }),
    status: failure === undefined ? 'produced' : 'infraError',
    ...(ci === undefined ? {} : { ci }),
  })
}

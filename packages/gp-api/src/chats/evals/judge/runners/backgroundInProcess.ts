import { createHash } from 'node:crypto'
import type { JudgeReplay } from '@goodparty_org/contracts'
import { differenceInMilliseconds } from 'date-fns'
import type { PrismaClient } from '@/generated/prisma'
import { loadAgentPrompt } from '@/agents/agentPrompt'
import { AGENTS, type AgentName } from '@/agents/agents.registry'
import type { RunView } from '@/agents/types'
import { PRICING_VERSION } from '../pricing'
import {
  isoUtc,
  RunRecordSchema,
  type Arm,
  type JsonValue,
  type RunRecord,
  type TraceStep,
  type Variant,
} from '../record'
import {
  type BackgroundCase,
  type Clock,
  ciContext,
  judgeRunId,
  JUDGE_SPEND_ENV,
} from './background'

// THE CANDIDATE ARM FOR AN AGENT THAT HAS MOVED INTO gp-api (evals option A).
// The base arm stays today's Fargate dispatch; this one starts the agent
// through AgentsService in the arm's own booted app, waits on getRun, and
// emits the same record shape, so everything above a runner reads both arms
// alike. The replay ticket rides on the run, per case, never process-wide:
// an arm runs several cases at once.

// Judge agent id -> the registry agent that replaces it.
export const IN_PROCESS_AGENTS: Readonly<Record<string, AgentName>> = {
  meeting_briefing: 'meetingBriefing',
}

export interface InProcessAgents {
  run(
    name: AgentName,
    input: unknown,
    options?: { judgeReplay?: JudgeReplay },
  ): Promise<{ runId: string }>
  getRun(runId: string): Promise<RunView>
}

export interface InProcessRunnerDeps {
  agents: InProcessAgents
  clock: Clock
}

export interface InProcessRunInput {
  sweepId: string
  agentId: string
  agentName: AgentName
  arm: Arm
  attempt: number
  agentCase: BackgroundCase
  variant: Omit<Variant, 'configDigest' | 'model'>
  organizationSlug: string
  electedOfficeId: string
  judgeReplay?: JudgeReplay
  poll: { timeoutMs: number; intervalMs: number }
  dataVersion?: string
  env?: NodeJS.ProcessEnv
}

// The organization and office the agent saves its artifact against. The arm's
// database is thrown away with the suite, so nothing here is cleaned up.
// Derived from the case and attempt, never the clock, so both halves of a
// rerun land on the same slug.
export const stageInProcessCase = async (
  prisma: PrismaClient,
  userId: number,
  key: { sweepId: string; caseId: string; attempt: number },
): Promise<{ organizationSlug: string; electedOfficeId: string }> => {
  const organizationSlug = `judge-ip-${createHash('sha256')
    .update(`${key.sweepId}:${key.caseId}:${key.attempt}`)
    .digest('hex')
    .slice(0, 16)}`
  await prisma.organization.create({
    data: { slug: organizationSlug, ownerId: userId },
  })
  const office = await prisma.electedOffice.create({
    data: { organizationSlug, userId },
  })
  return { organizationSlug, electedOfficeId: office.id }
}

const TERMINAL = new Set<RunView['status']>([
  'completed',
  'failed',
  'superseded',
])

// What the agent reads: its prompt, model and tools. The same role the base
// arm's manifest-plus-instruction digest plays.
export const inProcessConfigDigest = (agentName: AgentName): string => {
  const agent = AGENTS[agentName]
  return createHash('sha256')
    .update(agent.model)
    .update(agent.tools.map((tool) => tool.name).join(','))
    .update(loadAgentPrompt(agent.prompt))
    .digest('hex')
}

const stepTrace = (view: RunView | undefined): TraceStep[] =>
  Array.from({ length: view?.steps ?? 0 }, (_step, index) => ({
    index,
    kind: 'text' as const,
  }))

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
      ? 'staged input files exist only on the Fargate runner; the ' +
        'in-process candidate has no /workspace to read them from'
      : undefined

  let view: RunView | undefined
  let failure = refusal
  if (failure === undefined) {
    let { runId: agentRunId } = await deps.agents.run(
      input.agentName,
      {
        ...input.agentCase.params,
        organizationSlug: input.organizationSlug,
        electedOfficeId: input.electedOfficeId,
        requestedAt: startedAt.toISOString(),
      },
      input.judgeReplay ? { judgeReplay: input.judgeReplay } : undefined,
    )
    const deadline = startedAt.getTime() + input.poll.timeoutMs
    for (;;) {
      view = await deps.agents.getRun(agentRunId)
      // A shape change replaces the run with a fresh one; follow it.
      if (view.supersededBy) {
        agentRunId = view.supersededBy
        continue
      }
      if (TERMINAL.has(view.status)) break
      if (deps.clock.now().getTime() >= deadline) break
      await deps.clock.sleep(input.poll.intervalMs)
    }
    failure =
      view.status === 'completed' && view.artifact !== undefined
        ? undefined
        : TERMINAL.has(view.status)
          ? `agent run ${agentRunId} ended ${view.status}` +
            (view.error ? `: ${view.error}` : '')
          : `agent run ${agentRunId} still ${view.status} after ` +
            `${input.poll.timeoutMs}ms`
  }
  const endedAt = deps.clock.now()

  const steps = stepTrace(view)
  const trace = [
    ...steps,
    ...(failure === undefined
      ? []
      : [{ index: steps.length, kind: 'error' as const, error: failure }]),
  ]
  const ci = ciContext(env)
  const params: Record<string, JsonValue> = input.agentCase.params

  return RunRecordSchema.parse({
    schemaVersion: 1,
    sweepId: input.sweepId,
    runId,
    agentId: input.agentId,
    agentShape: 'background',
    arm: input.arm,
    variant: {
      ...input.variant,
      model: AGENTS[input.agentName].model,
      configDigest: inProcessConfigDigest(input.agentName),
    },
    caseId: input.agentCase.caseId,
    attempt: input.attempt,
    startedAt: isoUtc(startedAt),
    endedAt: isoUtc(endedAt),
    input: {
      kind: 'params',
      value: {
        params,
        inputFiles: (input.agentCase.inputFiles ?? []).map((file) => ({
          bucket: file.bucket,
          key: file.key,
          dest: file.dest,
        })),
      },
    },
    output:
      failure === undefined && view?.artifact !== undefined
        ? { kind: 'artifact', value: view.artifact }
        : null,
    trace,
    // RunView carries cost but no token counts, so the tokens read zero and
    // the cost is the engine's own figure.
    telemetry: {
      latencyMs: differenceInMilliseconds(endedAt, startedAt),
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(view?.costUsd !== undefined && {
        cost: { usdAtCapture: view.costUsd, pricingVersion: PRICING_VERSION },
      }),
      toolCalls: 0,
      toolErrors: 0,
      retries: 0,
    },
    toolQueries: [],
    ...(input.dataVersion !== undefined && { dataVersion: input.dataVersion }),
    liveWeb: true,
    ...(input.judgeReplay !== undefined && { pageReplay: input.judgeReplay }),
    status: failure === undefined ? 'produced' : 'infraError',
    ...(ci === undefined ? {} : { ci }),
  })
}

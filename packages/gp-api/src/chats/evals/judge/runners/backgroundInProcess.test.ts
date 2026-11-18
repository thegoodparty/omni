import type { JudgeReplay } from '@goodparty_org/contracts'
import { describe, expect, it } from 'vitest'
import type { AgentRunReplay } from '@/agents/tools/judgeReplay'
import { AgentMessageRole, AgentRunStatus } from '@/generated/prisma'
import {
  type InProcessMessage,
  type InProcessRunInput,
  type InProcessRunnerDeps,
  type InProcessRunView,
  runInProcessBackgroundCase,
} from './backgroundInProcess'

const OUTPUT = {
  schema_version: 1,
  list: 'trending',
  issues: [],
  data_quality: 'insufficient_signal',
  data_quality_reason: 'No coverage inside ninety days.',
}

const assistantRow = (
  content: unknown[],
  tokens = { input: 1_000, output: 100, cacheRead: 600, cacheWrite: 200 },
): InProcessMessage => ({
  role: AgentMessageRole.assistant,
  parts: content,
  inputTokens: tokens.input,
  outputTokens: tokens.output,
  cacheReadTokens: tokens.cacheRead,
  cacheWriteTokens: tokens.cacheWrite,
})

const toolRow = (content: unknown[]): InProcessMessage => ({
  role: AgentMessageRole.tool,
  parts: content,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
})

const MESSAGES: InProcessMessage[] = [
  assistantRow([
    {
      type: 'tool-call',
      toolCallId: 'feed',
      toolName: 'getCommunityIssues',
      input: { list: 'trending' },
    },
    {
      type: 'tool-call',
      toolCallId: 'search',
      toolName: 'webSearch',
      input: { query: 'Kenedy County news' },
    },
  ]),
  toolRow([
    {
      type: 'tool-result',
      toolCallId: 'feed',
      toolName: 'getCommunityIssues',
      output: { type: 'error-text', value: 'database unavailable' },
    },
  ]),
  assistantRow([
    {
      type: 'tool-call',
      toolCallId: 'submit',
      toolName: 'submitOutput',
      input: { output: OUTPUT },
    },
  ]),
  toolRow([
    {
      type: 'tool-result',
      toolCallId: 'submit',
      toolName: 'submitOutput',
      output: { type: 'text', value: 'accepted' },
    },
  ]),
]

const runView = (
  status: AgentRunStatus,
  extra: Partial<InProcessRunView> = {},
): InProcessRunView => ({
  status,
  error: null,
  organizationSlug: 'judge-fixture',
  messages: MESSAGES,
  ...extra,
})

const fakeDeps = (views: InProcessRunView[]) => {
  let now = new Date('2026-11-15T10:00:00Z')
  const started: { name: string; input: unknown; replay?: AgentRunReplay }[] =
    []
  const deps: InProcessRunnerDeps = {
    start: async (name, input, replay) => {
      started.push({ name, input, replay })
      return { runId: 'agent-run-1' }
    },
    readRun: async () =>
      views.shift() ?? runView(AgentRunStatus.running, { messages: [] }),
    clock: {
      now: () => now,
      sleep: async (ms) => {
        now = new Date(now.getTime() + ms)
      },
    },
  }
  return { deps, started }
}

const replay: JudgeReplay = {
  mode: 'replay',
  key: '_judge/replay/sweep/judge-1-1/trending_issues/a2-thin-1',
}

const input = (
  overrides: Partial<InProcessRunInput> = {},
): InProcessRunInput => ({
  sweepId: 'judge-1-1',
  agentId: 'trending_issues',
  arm: 'candidate',
  attempt: 1,
  agentCase: {
    caseId: 'a2-thin',
    params: {
      organization_slug: 'judge-fixture',
      state: 'TX',
      office: 'County Commissioner',
      district_descriptor: 'Kenedy County Commissioner, Precinct 2, TX',
    },
  },
  variant: { ref: 'agents/v1-community-issues', commit: 'abc123' },
  replay,
  poll: { timeoutMs: 60_000, intervalMs: 5_000 },
  env: { JUDGE_SPEND: 'true' },
  ...overrides,
})

describe('runInProcessBackgroundCase', () => {
  it('runs the agent on the case and records the artifact the PMF Engine would publish', async () => {
    const { deps, started } = fakeDeps([
      runView(AgentRunStatus.running, { messages: MESSAGES.slice(0, 1) }),
      runView(AgentRunStatus.completed),
    ])

    const record = await runInProcessBackgroundCase(deps, input())

    expect(started).toEqual([
      {
        name: 'trending_issues',
        input: {
          organizationSlug: 'judge-fixture',
          state: 'TX',
          office: 'County Commissioner',
          districtDescriptor: 'Kenedy County Commissioner, Precinct 2, TX',
          today: '2026-11-15',
        },
        replay: {
          replay,
          judgeRunId: record.runId,
          issuedAt: Date.parse('2026-11-15T10:00:00Z') / 1000,
        },
      },
    ])
    expect(record).toMatchObject({
      agentId: 'trending_issues',
      agentShape: 'background',
      arm: 'candidate',
      caseId: 'a2-thin',
      status: 'produced',
      output: {
        kind: 'artifact',
        value: {
          ...OUTPUT,
          organization_slug: 'judge-fixture',
          generated_for_run_id: 'agent-run-1',
        },
      },
      variant: { model: 'claude-sonnet-4-6' },
      liveWeb: true,
      pageReplay: replay,
      telemetry: {
        tokens: { input: 400, output: 200, cacheRead: 1_200, cacheWrite: 400 },
        toolCalls: 3,
        toolErrors: 1,
      },
    })
    expect(record.trace).toEqual([
      {
        index: 0,
        kind: 'tool',
        tool: 'getCommunityIssues',
        error: 'database unavailable',
      },
      { index: 1, kind: 'tool', tool: 'webSearch' },
      { index: 2, kind: 'tool', tool: 'submitOutput' },
    ])
  })

  it('records a failed run as an infraError with its reason', async () => {
    const { deps } = fakeDeps([
      runView(AgentRunStatus.failed, { error: 'model refused' }),
    ])
    const record = await runInProcessBackgroundCase(deps, input())
    expect(record.status).toBe('infraError')
    expect(record.output).toBeNull()
    expect(record.trace.at(-1)?.error).toContain('model refused')
  })

  it('gives up at the poll timeout', async () => {
    const { deps } = fakeDeps([])
    const record = await runInProcessBackgroundCase(
      deps,
      input({ poll: { timeoutMs: 20_000, intervalMs: 5_000 } }),
    )
    expect(record.status).toBe('infraError')
    expect(record.trace.map((step) => step.error)).toContainEqual(
      expect.stringContaining('still running'),
    )
  })

  it('refuses a case that stages input files, without starting a run', async () => {
    const { deps, started } = fakeDeps([])
    const base = input()
    const record = await runInProcessBackgroundCase(
      deps,
      input({
        agentCase: {
          ...base.agentCase,
          inputFiles: [{ bucket: 'b', key: 'k', dest: 'agenda.pdf' }],
        },
      }),
    )
    expect(started).toHaveLength(0)
    expect(record.status).toBe('infraError')
  })

  it('refuses to start without JUDGE_SPEND', async () => {
    const { deps } = fakeDeps([])
    await expect(
      runInProcessBackgroundCase(deps, input({ env: {} })),
    ).rejects.toThrow('JUDGE_SPEND')
  })
})

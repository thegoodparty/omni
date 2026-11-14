import type { JudgeReplay } from '@goodparty_org/contracts'
import { describe, expect, it } from 'vitest'
import type { AgentName } from '@/agents/agents.registry'
import type { RunView } from '@/agents/types'
import {
  runInProcessBackgroundCase,
  type InProcessAgents,
  type InProcessRunInput,
} from './backgroundInProcess'

const artifact = { briefing_status: 'briefing_ready' }

const view = (status: RunView['status'], extra: Partial<RunView> = {}) => ({
  runId: 'agent-run-1',
  agent: 'meetingBriefing',
  status,
  shapeHash: 'hash',
  steps: 3,
  ...extra,
})

const fakeAgents = (views: RunView[]) => {
  const calls: Array<{
    name: AgentName
    input: unknown
    options?: { judgeReplay?: JudgeReplay }
  }> = []
  const polled: string[] = []
  const agents: InProcessAgents = {
    run: async (name, input, options) => {
      calls.push({ name, input, options })
      return { runId: 'agent-run-1' }
    },
    getRun: async (runId) => {
      polled.push(runId)
      return views.shift() ?? view('running')
    },
  }
  return { agents, calls, polled }
}

let now = new Date('2026-11-13T10:00:00Z')
const deps = (agents: InProcessAgents) => ({
  agents,
  clock: {
    now: () => now,
    sleep: async (ms: number) => {
      now = new Date(now.getTime() + ms)
    },
  },
})

const replay: JudgeReplay = {
  mode: 'replay',
  key: '_judge/replay/sweep/judge-1-1/meeting_briefing/a1-baseline-1',
}

const input = (
  overrides: Partial<InProcessRunInput> = {},
): InProcessRunInput => ({
  sweepId: 'judge-1-1',
  agentId: 'meeting_briefing',
  agentName: 'meetingBriefing',
  arm: 'candidate',
  attempt: 1,
  agentCase: {
    caseId: 'a1-baseline',
    params: {
      officialName: 'Rowan Ledbetter',
      state: 'NC',
      meetingDate: '2026-09-03',
    },
  },
  variant: { ref: 'poc/agents-ai-sdk', commit: 'abc123' },
  organizationSlug: 'judge-ip-1',
  electedOfficeId: 'office-1',
  judgeReplay: replay,
  poll: { timeoutMs: 60_000, intervalMs: 5_000 },
  env: { JUDGE_SPEND: 'true' },
  ...overrides,
})

describe('runInProcessBackgroundCase', () => {
  it('runs the agent with the case params and its replay ticket, and records the artifact', async () => {
    const { agents, calls } = fakeAgents([
      view('running'),
      view('completed', { artifact, costUsd: 1.25 }),
    ])
    const record = await runInProcessBackgroundCase(deps(agents), input())

    expect(calls).toEqual([
      {
        name: 'meetingBriefing',
        input: expect.objectContaining({
          officialName: 'Rowan Ledbetter',
          organizationSlug: 'judge-ip-1',
          electedOfficeId: 'office-1',
          requestedAt: expect.any(String),
        }),
        options: { judgeReplay: replay },
      },
    ])
    expect(record).toMatchObject({
      agentId: 'meeting_briefing',
      agentShape: 'background',
      arm: 'candidate',
      caseId: 'a1-baseline',
      status: 'produced',
      output: { kind: 'artifact', value: artifact },
      pageReplay: replay,
      variant: { model: 'claude-sonnet-4-6' },
      telemetry: { cost: { usdAtCapture: 1.25 } },
    })
    expect(record.input).toEqual({
      kind: 'params',
      value: { params: input().agentCase.params, inputFiles: [] },
    })
    expect(record.trace).toHaveLength(3)
  })

  it('follows a run superseded by a shape change to the run that replaced it', async () => {
    const { agents, polled } = fakeAgents([
      view('superseded', { supersededBy: 'agent-run-2' }),
      view('completed', { runId: 'agent-run-2', artifact }),
    ])
    const record = await runInProcessBackgroundCase(deps(agents), input())
    expect(polled).toEqual(['agent-run-1', 'agent-run-2'])
    expect(record.status).toBe('produced')
  })

  it('records a failed run as an infraError with the reason', async () => {
    const { agents } = fakeAgents([view('failed', { error: 'model refused' })])
    const record = await runInProcessBackgroundCase(deps(agents), input())
    expect(record.status).toBe('infraError')
    expect(record.output).toBeNull()
    expect(record.trace.at(-1)?.error).toContain('model refused')
  })

  it('gives up at the poll timeout', async () => {
    const { agents } = fakeAgents([])
    const record = await runInProcessBackgroundCase(
      deps(agents),
      input({ poll: { timeoutMs: 20_000, intervalMs: 5_000 } }),
    )
    expect(record.status).toBe('infraError')
    expect(record.trace.at(-1)?.error).toContain('still running')
  })

  it('refuses a case that stages input files, without starting a run', async () => {
    const { agents, calls } = fakeAgents([])
    const record = await runInProcessBackgroundCase(
      deps(agents),
      input({
        agentCase: {
          caseId: 'b1-packet',
          params: { state: 'NC' },
          inputFiles: [{ bucket: 'b', key: 'k', dest: 'agenda.pdf' }],
        },
      }),
    )
    expect(calls).toHaveLength(0)
    expect(record.status).toBe('infraError')
  })

  it('refuses to start without JUDGE_SPEND', async () => {
    const { agents } = fakeAgents([])
    await expect(
      runInProcessBackgroundCase(deps(agents), input({ env: {} })),
    ).rejects.toThrow('JUDGE_SPEND')
  })
})

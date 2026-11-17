import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AgentMessageRow } from './agentMessages'
import {
  type AgentLoopArgs,
  runAgentLoop,
  RunBudgetError,
  RunStoppedError,
  SUBMIT_TOOL,
} from './aiSdkLoop'

const OutputSchema = z.union([
  z.object({ status: z.literal('found'), minutes: z.number() }),
  z.object({ status: z.literal('missing'), reason: z.string() }),
])

const callTool = (toolName: string, input: unknown) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start' as const, warnings: [] },
      {
        type: 'tool-call' as const,
        toolCallId: `call-${Math.random().toString(36).slice(2)}`,
        toolName,
        input: JSON.stringify(input),
      },
      {
        type: 'finish' as const,
        finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
      },
    ],
  }),
})

const loopArgs = (
  model: MockLanguageModelV3,
  saved: AgentMessageRow[],
  overrides: Partial<AgentLoopArgs> = {},
): AgentLoopArgs => ({
  agentName: 'testAgent',
  model,
  modelId: 'claude-sonnet-4-6',
  system: 'Do the work.',
  messages: [{ role: 'user', content: '{}' }],
  tools: [
    {
      name: 'lookUp',
      description: 'Look it up.',
      input: z.object({}),
      execute: async () => 'nothing yet',
    },
  ],
  output: OutputSchema,
  toolContext: {
    runId: 'run-1',
    organizationSlug: 'org',
    signal: new AbortController().signal,
    get: () => {
      throw new Error('unused')
    },
  },
  savedSteps: 0,
  maxSteps: 5,
  maxNudges: 1,
  stopRequested: () => false,
  abortSignal: new AbortController().signal,
  saveRows: async (rows) => {
    saved.push(...rows)
  },
  ...overrides,
})

describe('runAgentLoop', () => {
  it('tells the model where a union output failed, then takes the fix', async () => {
    const prompts: string[] = []
    const model = new MockLanguageModelV3({
      doStream: async ({ prompt }) => {
        prompts.push(JSON.stringify(prompt))
        return callTool(SUBMIT_TOOL, {
          output:
            prompts.length === 1
              ? { status: 'found', minutes: 'eight' }
              : { status: 'found', minutes: 8 },
        })
      },
    })
    const saved: AgentMessageRow[] = []

    const output = await runAgentLoop(loopArgs(model, saved))

    expect(output).toEqual({ status: 'found', minutes: 8 })
    expect(saved).toHaveLength(4)
    expect(saved[1]).toMatchObject({
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(saved[2]).toMatchObject({ role: 'tool', model: undefined })
    const error = /"error-text","value":"([^"]*)"/.exec(prompts[1] ?? '')?.[1]
    expect(error).toContain('output.minutes')
    expect(error).not.toContain('eight')
  })

  it('returns an output already submitted in the saved messages without a model call', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error('no call expected')
      },
    })
    const output = await runAgentLoop(
      loopArgs(model, [], {
        messages: [
          { role: 'user', content: '{}' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: SUBMIT_TOOL,
                input: { output: { status: 'missing', reason: 'none' } },
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'call-1',
                toolName: SUBMIT_TOOL,
                output: { type: 'text', value: 'accepted' },
              },
            ],
          },
        ],
        savedSteps: 1,
      }),
    )

    expect(output).toEqual({ status: 'missing', reason: 'none' })
  })

  it('stops after the current step when asked to', async () => {
    let stop = false
    const model = new MockLanguageModelV3({
      doStream: async () => {
        stop = true
        return callTool('lookUp', {})
      },
    })
    const saved: AgentMessageRow[] = []

    await expect(
      runAgentLoop(loopArgs(model, saved, { stopRequested: () => stop })),
    ).rejects.toThrow(RunStoppedError)
    expect(saved).toHaveLength(2)
  })

  it('fails a run that spends its step budget without submitting', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => callTool('lookUp', {}),
    })
    const saved: AgentMessageRow[] = []

    await expect(
      runAgentLoop(loopArgs(model, saved, { savedSteps: 3, maxSteps: 5 })),
    ).rejects.toThrow(RunBudgetError)
    expect(saved).toHaveLength(4)
  })

  it('makes no model call on a resume that has already spent its budget', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error('no call expected')
      },
    })

    await expect(
      runAgentLoop(loopArgs(model, [], { savedSteps: 5, maxSteps: 5 })),
    ).rejects.toThrow('testAgent used its 5 steps without submitting')
  })

  it('saves a nudge as a user row and calls the model again', async () => {
    let calls = 0
    const model = new MockLanguageModelV3({
      doStream: async () => {
        calls++
        return calls === 1
          ? callTool('lookUp', {})
          : {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'stream-start' as const, warnings: [] },
                  {
                    type: 'text-start' as const,
                    id: 't1',
                  },
                  { type: 'text-delta' as const, id: 't1', delta: 'nothing to add' },
                  { type: 'text-end' as const, id: 't1' },
                  {
                    type: 'finish' as const,
                    finishReason: { unified: 'stop' as const, raw: 'end_turn' },
                    usage: {
                      inputTokens: {
                        total: 10,
                        noCache: 10,
                        cacheRead: 0,
                        cacheWrite: 0,
                      },
                      outputTokens: { total: 10, text: 10, reasoning: undefined },
                    },
                  },
                ],
              }),
            }
      },
    })
    const saved: AgentMessageRow[] = []

    const run = runAgentLoop(
      loopArgs(model, saved, {
        // The nudge is what ends up saving a user row; the run then exceeds its
        // one nudge and gives up.
        tools: [],
      }),
    )

    await expect(run).rejects.toThrow('ended without submitting its output')
    expect(saved.map((row) => row.role)).toEqual([
      'assistant',
      'user',
    ])
    expect(JSON.stringify(saved[1]?.parts)).toContain(SUBMIT_TOOL)
  })
})

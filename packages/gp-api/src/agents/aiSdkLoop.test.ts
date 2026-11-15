import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type AgentLoopArgs,
  runAgentLoop,
  RunStoppedError,
  type SavedStep,
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
  saved: SavedStep[],
  overrides: Partial<AgentLoopArgs> = {},
): AgentLoopArgs => ({
  agentName: 'testAgent',
  model,
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
  saveStep: async (step) => {
    saved.push(step)
  },
  saveNudge: async () => undefined,
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
    const saved: SavedStep[] = []

    const output = await runAgentLoop(loopArgs(model, saved))

    expect(output).toEqual({ status: 'found', minutes: 8 })
    expect(saved).toHaveLength(2)
    expect(saved[0]?.usage).toEqual({
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    const error = /"error-text","value":"([^"]*)"/.exec(prompts[1] ?? '')?.[1]
    expect(error).toContain('output.minutes')
    expect(error).not.toContain('eight')
  })

  it('returns an output already submitted in the saved steps without a model call', async () => {
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
    const saved: SavedStep[] = []

    await expect(
      runAgentLoop(loopArgs(model, saved, { stopRequested: () => stop })),
    ).rejects.toThrow(RunStoppedError)
    expect(saved).toHaveLength(1)
  })

  it('fails a run that spends its step budget without submitting', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => callTool('lookUp', {}),
    })
    const saved: SavedStep[] = []

    await expect(
      runAgentLoop(loopArgs(model, saved, { savedSteps: 3, maxSteps: 5 })),
    ).rejects.toThrow('testAgent used its 5 steps without submitting')
    expect(saved).toHaveLength(2)
  })
})

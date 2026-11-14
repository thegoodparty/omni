import type { ModuleRef } from '@nestjs/core'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { MeetingBriefingSchema } from '../meetingBriefing/meetingBriefing.schema'
import { fullBriefing } from '../meetingBriefing/meetingBriefingArtifact.fixture'
import { runAgentLoop, type SavedStep, SUBMIT_TOOL } from './aiSdkLoop'

const submit = (output: unknown) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start' as const, warnings: [] },
      {
        type: 'tool-call' as const,
        toolCallId: `call-${Math.random().toString(36).slice(2)}`,
        toolName: SUBMIT_TOOL,
        input: JSON.stringify({ output }),
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

describe('runAgentLoop', () => {
  it('tells the model where a union output failed, then takes the fix', async () => {
    const prompts: string[] = []
    const model = new MockLanguageModelV3({
      doStream: async ({ prompt }) => {
        prompts.push(JSON.stringify(prompt))
        return submit(
          prompts.length === 1
            ? { ...fullBriefing, estimated_read_minutes: 'eight' }
            : fullBriefing,
        )
      },
    })
    const saved: SavedStep[] = []

    const output = await runAgentLoop({
      agentName: 'meetingBriefing',
      model,
      system: 'Write the briefing.',
      messages: [{ role: 'user', content: '{}' }],
      tools: [],
      output: MeetingBriefingSchema,
      toolContext: {
        runId: 'run-1',
        organizationSlug: 'org',
        signal: new AbortController().signal,
        moduleRef: {} as ModuleRef,
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
    })

    expect(output).toMatchObject({ briefing_status: 'briefing_ready' })
    expect(saved).toHaveLength(2)
    expect(prompts[1]).toContain('output.estimated_read_minutes')
    expect(prompts[1]).not.toContain('Value:')
  })
})

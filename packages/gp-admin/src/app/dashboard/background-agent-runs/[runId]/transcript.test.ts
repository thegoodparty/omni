import { describe, expect, it } from 'vitest'
import type { BackgroundAgentMessage } from '@/shared/gpApi'
import { messageText, messageToolCalls, messageToolResults } from './transcript'

const message = (
  overrides: Partial<BackgroundAgentMessage> = {}
): BackgroundAgentMessage => ({
  index: 0,
  role: 'assistant',
  parts: [],
  model: 'claude-sonnet-4-6',
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  ...overrides,
})

describe('messageText', () => {
  it('joins the text parts and ignores the rest', () => {
    const text = messageText(
      message({
        parts: [
          { type: 'text', text: 'first' },
          { type: 'tool-call', toolCallId: 'c1', toolName: 'webSearch' },
          { type: 'text', text: 'second' },
        ],
      })
    )

    expect(text).toBe('first\nsecond')
  })

  it('is empty for a row with no text', () => {
    expect(messageText(message())).toBe('')
  })
})

describe('messageToolCalls', () => {
  it('reads the tool calls with their input, pretty-printed', () => {
    const calls = messageToolCalls(
      message({
        parts: [
          { type: 'text', text: 'looking it up' },
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'webSearch',
            input: { query: 'zoning' },
          },
        ],
      })
    )

    expect(calls).toEqual([
      {
        toolCallId: 'c1',
        toolName: 'webSearch',
        input: '{\n  "query": "zoning"\n}',
      },
    ])
  })

  it('reads no calls from a tool row', () => {
    expect(
      messageToolCalls(
        message({
          role: 'tool',
          parts: [{ type: 'tool-result', toolCallId: 'c1', output: {} }],
        })
      )
    ).toEqual([])
  })
})

describe('messageToolResults', () => {
  it('reads the tool results with their output', () => {
    const results = messageToolResults(
      message({
        role: 'tool',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'webSearch',
            output: { type: 'json', value: ['a'] },
          },
        ],
      })
    )

    expect(results).toEqual([
      {
        toolCallId: 'c1',
        toolName: 'webSearch',
        output: '{\n  "type": "json",\n  "value": [\n    "a"\n  ]\n}',
      },
    ])
  })
})

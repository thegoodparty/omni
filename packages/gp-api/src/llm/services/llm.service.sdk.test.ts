import { createAnthropic } from '@ai-sdk/anthropic'
import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { LlmService, type AnthropicProviderFactory } from './llm.service'

// These tests run the real AI SDK streamText loop and the real Anthropic
// provider. Only the HTTP layer is faked, so assertions are on the exact
// request bodies the provider would send to the Messages API. The other
// llm.service tests mock streamText and cannot see either behavior here.

type AnthropicBlock = Record<string, unknown>

type SseEvent = { event: string; data: Record<string, unknown> }

const usage = { input_tokens: 10, output_tokens: 5 }

const messageStart = (): SseEvent => ({
  event: 'message_start',
  data: {
    type: 'message_start',
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage,
    },
  },
})

const messageEnd = (stopReason: string): SseEvent[] => [
  {
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 5 },
    },
  },
  { event: 'message_stop', data: { type: 'message_stop' } },
]

const toolUseResponse = (
  id: string,
  name: string,
  input: Record<string, unknown>,
): SseEvent[] => [
  messageStart(),
  {
    event: 'content_block_start',
    data: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id, name, input: {} },
    },
  },
  {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
    },
  },
  {
    event: 'content_block_stop',
    data: { type: 'content_block_stop', index: 0 },
  },
  ...messageEnd('tool_use'),
]

const textResponse = (text: string): SseEvent[] => [
  messageStart(),
  {
    event: 'content_block_start',
    data: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
  },
  {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    },
  },
  {
    event: 'content_block_stop',
    data: { type: 'content_block_stop', index: 0 },
  },
  ...messageEnd('end_turn'),
]

const sseResponse = (events: SseEvent[]): Response =>
  new Response(
    events
      .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
      .join(''),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )

// Serves the scripted responses in order and records every request body.
const scriptedAnthropic = (
  responses: SseEvent[][],
): {
  factory: AnthropicProviderFactory
  requests: Array<Record<string, unknown>>
} => {
  const requests: Array<Record<string, unknown>> = []
  const fetchImpl = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    requests.push(JSON.parse(String(init?.body)))
    const next = responses[requests.length - 1]
    if (!next) throw new Error(`Unexpected request #${requests.length}`)
    return sseResponse(next)
  }
  const factory: AnthropicProviderFactory = ({ apiKey }) => {
    const provider = createAnthropic({ apiKey, fetch: fetchImpl })
    return {
      languageModel: (model: string) => provider(model),
      webSearchTool: () => {
        throw new Error('not used')
      },
    }
  }
  return { factory, requests }
}

const buildService = (factory: AnthropicProviderFactory): LlmService =>
  new LlmService(createMockLogger(), undefined, undefined, undefined, factory)

const messagesOf = (
  body: Record<string, unknown>,
): Array<{ role: string; content: AnthropicBlock[] }> =>
  body.messages as Array<{ role: string; content: AnthropicBlock[] }>

// Every place cache_control appears in a request body, as a readable path.
const cacheControlPaths = (body: Record<string, unknown>): string[] => {
  const paths: string[] = []
  if ('cache_control' in body) paths.push('top-level')
  const system = body.system as AnthropicBlock[] | undefined
  system?.forEach((b, i) => {
    if (b.cache_control) paths.push(`system[${i}]`)
  })
  const tools = body.tools as AnthropicBlock[] | undefined
  tools?.forEach((t, i) => {
    if (t.cache_control) paths.push(`tools[${i}]`)
  })
  messagesOf(body).forEach((m, i) => {
    m.content.forEach((b, j) => {
      if (b.cache_control) paths.push(`messages[${i}].content[${j}]:${b.type}`)
    })
  })
  return paths
}

const lookupTool = (execute: (input: { q: string }) => unknown) => ({
  description: 'Look something up',
  inputSchema: z.object({ q: z.string() }),
  execute,
})

const drain = async (stream: AsyncIterable<string>): Promise<string> => {
  let text = ''
  for await (const c of stream) text += c
  return text
}

describe('LlmService.streamChatCompletion against the real AI SDK', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key')
    vi.stubEnv('AI_MODELS', 'claude-sonnet-4-6')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('when a tool throws', () => {
    it('sends the error to the model as an error tool result and keeps the turn going', async () => {
      const { factory, requests } = scriptedAnthropic([
        toolUseResponse('toolu_1', 'lookup', { q: 'x' }),
        textResponse('Sorry, the lookup failed.'),
      ])
      const onToolCallError = vi.fn()
      const onToolCallEnd = vi.fn()
      const onStreamError = vi.fn()

      const result = await buildService(factory).streamChatCompletion({
        messages: [{ role: 'user', content: 'Look up x' }],
        tools: {
          lookup: lookupTool(() => {
            throw new Error('database unavailable')
          }),
        },
        retries: 0,
        onToolCallError,
        onToolCallEnd,
        onStreamError,
      })

      expect(await drain(result.textStream)).toBe('Sorry, the lookup failed.')
      expect(await result.finalText).toBe('Sorry, the lookup failed.')

      // The SDK catches the throw, so the turn does not fail.
      expect(onStreamError).not.toHaveBeenCalled()
      expect(onToolCallEnd).not.toHaveBeenCalled()
      expect(onToolCallError).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'lookup', toolCallId: 'toolu_1' }),
      )

      // The second model call carries the thrown message alone, as an error
      // tool result, without the error's class name. Whatever a tool throws
      // reaches the model.
      expect(requests).toHaveLength(2)
      const lastMessage = messagesOf(requests[1]!).at(-1)!
      expect(lastMessage.role).toBe('user')
      expect(lastMessage.content).toEqual([
        expect.objectContaining({
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          is_error: true,
          content: 'database unavailable',
        }),
      ])
    })

    it('lists the failed call in toolCalls even though the last step made none', async () => {
      const { factory } = scriptedAnthropic([
        toolUseResponse('toolu_1', 'lookup', { q: 'x' }),
        textResponse('Done.'),
      ])

      const result = await buildService(factory).streamChatCompletion({
        messages: [{ role: 'user', content: 'Look up x' }],
        tools: {
          lookup: lookupTool(() => {
            throw new Error('boom')
          }),
        },
        retries: 0,
      })
      await drain(result.textStream)

      // v7 collects tool calls from every step; v6 returned the last step's.
      expect(await result.toolCalls).toEqual([
        expect.objectContaining({ id: 'toolu_1' }),
      ])
    })
  })

  describe('prompt cache breakpoint', () => {
    it('is one top-level cache_control on every step, with no block marked', async () => {
      const { factory, requests } = scriptedAnthropic([
        toolUseResponse('toolu_1', 'lookup', { q: 'x' }),
        textResponse('Found it.'),
      ])

      const result = await buildService(factory).streamChatCompletion({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Earlier question' },
          { role: 'assistant', content: 'Earlier answer' },
          { role: 'user', content: 'Look up x' },
        ],
        tools: { lookup: lookupTool(() => ({ value: 42 })) },
        retries: 0,
      })
      await drain(result.textStream)

      // Anthropic's automatic caching: the API places the breakpoint on the
      // last cacheable block, so each step reads what the previous one wrote.
      expect(requests).toHaveLength(2)
      for (const body of requests) {
        expect(cacheControlPaths(body)).toEqual(['top-level'])
        expect(body.cache_control).toEqual({ type: 'ephemeral' })
      }
    })
  })

  describe('when the step budget runs out', () => {
    it('runs one more step with tools off and the tool history as text', async () => {
      const { factory, requests } = scriptedAnthropic([
        toolUseResponse('toolu_1', 'lookup', { q: 'x' }),
        textResponse('Here is what I found.'),
      ])
      const onStreamError = vi.fn()

      const result = await buildService(factory).streamChatCompletion({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Look up x' },
        ],
        tools: { lookup: lookupTool(() => ({ value: 42 })) },
        maxSteps: 1,
        retries: 0,
        onStreamError,
      })

      expect(await drain(result.textStream)).toBe('Here is what I found.')
      expect(onStreamError).not.toHaveBeenCalled()
      expect(requests).toHaveLength(2)
      const finalStep = requests[1]!
      expect(finalStep.system).toEqual([
        expect.objectContaining({ text: 'You are helpful.' }),
      ])
      const blockTypes = messagesOf(finalStep).flatMap((m) =>
        m.content.map((b) => b.type),
      )
      expect(blockTypes).not.toContain('tool_use')
      expect(blockTypes).not.toContain('tool_result')
    })
  })

  describe('tracing', () => {
    const exporter = new InMemorySpanExporter()

    beforeEach(() => {
      trace.setGlobalTracerProvider(
        new BasicTracerProvider({
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        }),
      )
    })

    afterEach(() => {
      trace.disable()
      exporter.reset()
    })

    it('emits a span per call with usage but no prompt or response text', async () => {
      const { factory } = scriptedAnthropic([textResponse('Hello there.')])

      const result = await buildService(factory).streamChatCompletion({
        messages: [{ role: 'user', content: 'secret prompt text' }],
        retries: 0,
      })
      await drain(result.textStream)

      const spans = exporter.getFinishedSpans()
      // v7 names spans by the OpenTelemetry GenAI conventions; our functionId
      // is the agent name on the invoke_agent span.
      const call = spans.find(
        (s) =>
          s.attributes['gen_ai.agent.name'] === 'llm.stream-chat-completion',
      )
      expect(call?.name).toBe('invoke_agent claude-sonnet-4-6')
      expect(call?.attributes['gen_ai.usage.input_tokens']).toBe(10)
      const serialized = JSON.stringify(spans.map((s) => s.attributes))
      expect(serialized).not.toContain('secret prompt text')
      expect(serialized).not.toContain('Hello there.')
    })
  })
})

import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  LlmService,
  type AnthropicProvider,
  type AnthropicProviderFactory,
  type GenerateObjectFn,
  type GenerateTextFn,
  type StreamTextFn,
} from './llm.service'

const stubAnthropicFactory: AnthropicProviderFactory = () =>
  ({
    languageModel: (model: string) => ({ modelId: model }) as never,
    webSearchTool: () => ({}) as never,
  }) as AnthropicProvider

const USER_MSG = { role: 'user' as const, content: 'Hi' }

const fakeTextStream = (chunks: string[]): AsyncIterable<string> => ({
  async *[Symbol.asyncIterator]() {
    for (const c of chunks) yield c
  },
})

const fakeStreamResult = (
  overrides: {
    chunks?: string[]
    finalText?: string
    inputTokens?: number
    outputTokens?: number
    toolCalls?: Array<{
      toolCallId: string
      toolName: string
      input: unknown
    }>
  } = {},
): unknown => {
  const chunks = overrides.chunks ?? ['ok']
  const finalText = overrides.finalText ?? chunks.join('')
  const inputTokens = overrides.inputTokens ?? 1
  const outputTokens = overrides.outputTokens ?? 1
  return {
    textStream: fakeTextStream(chunks),
    text: Promise.resolve(finalText),
    usage: Promise.resolve({
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    }),
    totalUsage: Promise.resolve({
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    }),
    toolCalls: Promise.resolve(overrides.toolCalls ?? []),
  }
}

const buildStreamService = (): {
  service: LlmService
  streamTextFn: ReturnType<typeof vi.fn>
} => {
  const streamTextFn = vi.fn()
  const service = new LlmService(
    createMockLogger(),
    streamTextFn as unknown as StreamTextFn,
    vi.fn() as unknown as GenerateTextFn,
    vi.fn() as unknown as GenerateObjectFn,
    stubAnthropicFactory,
  )
  return { service, streamTextFn }
}

describe('LlmService.streamChatCompletion', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    process.env.AI_MODELS = 'claude-sonnet-4-6,claude-opus-4-7'
    delete process.env.TOGETHER_AI_KEY
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('yields text deltas through textStream and resolves finalText', async () => {
    const { service, streamTextFn } = buildStreamService()
    streamTextFn.mockReturnValueOnce(
      fakeStreamResult({
        chunks: ['Hello', ' ', 'world'],
        finalText: 'Hello world',
        inputTokens: 5,
        outputTokens: 3,
      }),
    )

    const result = await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 0,
    })

    const chunks: string[] = []
    for await (const c of result.textStream) chunks.push(c)

    expect(chunks).toEqual(['Hello', ' ', 'world'])
    expect(await result.finalText).toBe('Hello world')
    expect(result.model).toBe('claude-sonnet-4-6')

    const usage = await result.usage
    expect(usage).toEqual({
      inputTokens: 5,
      outputTokens: 3,
      totalTokens: 8,
    })
  })

  it('forwards messages, abortSignal, sampling, and userId header to streamText', async () => {
    const { service, streamTextFn } = buildStreamService()
    streamTextFn.mockReturnValueOnce(fakeStreamResult())
    const controller = new AbortController()

    await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 0,
      abortSignal: controller.signal,
      temperature: 0.5,
      maxOutputTokens: 256,
      maxSteps: 3,
      userId: 'u-42',
    })

    const call = firstOrThrow(streamTextFn.mock.calls)[0]
    expect(call.messages).toEqual([{ role: 'user', content: 'Hi' }])
    expect(call.abortSignal).toBe(controller.signal)
    expect(call.temperature).toBe(0.5)
    expect(call.maxOutputTokens).toBe(256)
    expect(call.headers).toMatchObject({ 'X-User-Id': 'u-42' })
  })

  it('maps Vercel-style tool calls into the facade ToolCall shape', async () => {
    const { service, streamTextFn } = buildStreamService()
    streamTextFn.mockReturnValueOnce(
      fakeStreamResult({
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'lookup_voter',
            input: { voterId: 42 },
          },
        ],
      }),
    )

    const result = await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 0,
    })

    expect(await result.toolCalls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'lookup_voter',
          arguments: JSON.stringify({ voterId: 42 }),
        },
      },
    ])
  })

  it('passes tools through with Vercel tool() shape when provided', async () => {
    const { service, streamTextFn } = buildStreamService()
    streamTextFn.mockReturnValueOnce(fakeStreamResult())
    const lookupVoter = vi.fn().mockResolvedValue({ name: 'Jane' })

    await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 0,
      tools: {
        lookup_voter: {
          description: 'Look up a voter by id',
          inputSchema: z.object({ voterId: z.number() }),
          execute: lookupVoter,
        },
      },
      maxSteps: 2,
    })

    const call = firstOrThrow(streamTextFn.mock.calls)[0]
    expect(call.tools).toHaveProperty('lookup_voter')
    expect(call.tools.lookup_voter.description).toBe('Look up a voter by id')
    expect(typeof call.tools.lookup_voter.execute).toBe('function')
    expect(call.stopWhen).toBeDefined()
  })

  it('falls back to next model when streamText throws at connect-time', async () => {
    const { service, streamTextFn } = buildStreamService()
    const transient = Object.assign(new Error('connect failed'), {
      status: 500,
    })
    streamTextFn
      .mockImplementationOnce(() => {
        throw transient
      })
      .mockReturnValueOnce(
        fakeStreamResult({ chunks: ['recovered'], finalText: 'recovered' }),
      )

    const result = await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6', 'claude-opus-4-7'],
      retries: 0,
    })

    expect(result.model).toBe('claude-opus-4-7')
    expect(await result.finalText).toBe('recovered')
    expect(streamTextFn).toHaveBeenCalledTimes(2)
  })

  it('does not fall back on permanent 4xx connect errors', async () => {
    const { service, streamTextFn } = buildStreamService()
    const perm = Object.assign(new Error('unauthorized'), { status: 401 })
    streamTextFn.mockImplementationOnce(() => {
      throw perm
    })

    await expect(
      service.streamChatCompletion({
        messages: [USER_MSG],
        models: ['claude-sonnet-4-6', 'claude-opus-4-7'],
        retries: 0,
      }),
    ).rejects.toThrow('unauthorized')

    expect(streamTextFn).toHaveBeenCalledTimes(1)
  })

  it('uses default models when none provided', async () => {
    const { service, streamTextFn } = buildStreamService()
    streamTextFn.mockReturnValueOnce(fakeStreamResult())

    const result = await service.streamChatCompletion({
      messages: [USER_MSG],
      retries: 0,
    })

    expect(result.model).toBe('claude-sonnet-4-6')
  })

  it('routes model names through the anthropic provider', async () => {
    const anthropicResolve = vi.fn((model: string) => ({
      provider: 'anthropic',
      modelId: model,
    }))
    const anthropicProviderFactory: AnthropicProviderFactory = vi.fn(() => ({
      languageModel: anthropicResolve as never,
      webSearchTool: vi.fn() as never,
    }))

    const streamTextFn = vi.fn().mockReturnValue(fakeStreamResult())
    const service = new LlmService(
      createMockLogger(),
      streamTextFn as unknown as StreamTextFn,
      vi.fn() as unknown as GenerateTextFn,
      vi.fn() as unknown as GenerateObjectFn,
      anthropicProviderFactory,
    )

    await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 0,
    })

    expect(anthropicProviderFactory).toHaveBeenCalledWith({
      apiKey: 'test-anthropic-key',
    })
    expect(anthropicResolve).toHaveBeenCalledWith('claude-sonnet-4-6')
    expect(firstOrThrow(streamTextFn.mock.calls)[0].model).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    })
  })

  it('registers Anthropic native web search and sets onChunk', async () => {
    const nativeTool = { __native: true }
    const webSearchTool = vi.fn(() => nativeTool)
    const anthropicProviderFactory: AnthropicProviderFactory = () => ({
      languageModel: ((m: string) => ({
        provider: 'anthropic',
        modelId: m,
      })) as never,
      webSearchTool: webSearchTool as never,
    })
    const streamTextFn = vi.fn().mockReturnValue(fakeStreamResult())
    const service = new LlmService(
      createMockLogger(),
      streamTextFn as unknown as StreamTextFn,
      vi.fn() as unknown as GenerateTextFn,
      vi.fn() as unknown as GenerateObjectFn,
      anthropicProviderFactory,
    )

    const spec = { kind: 'native_web_search' as const, maxUses: 3 }
    await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      tools: { web_search: spec },
      retries: 0,
    })

    expect(webSearchTool).toHaveBeenCalledWith(spec)
    const call = firstOrThrow(streamTextFn.mock.calls)[0]
    expect(call.tools.web_search).toBe(nativeTool)
    expect(typeof call.onChunk).toBe('function')
  })

  it('fires tool hooks for native web search from onChunk', async () => {
    const anthropicProviderFactory: AnthropicProviderFactory = () => ({
      languageModel: ((m: string) => ({
        provider: 'anthropic',
        modelId: m,
      })) as never,
      webSearchTool: (() => ({})) as never,
    })
    const streamTextFn = vi.fn().mockReturnValue(fakeStreamResult())
    const service = new LlmService(
      createMockLogger(),
      streamTextFn as unknown as StreamTextFn,
      vi.fn() as unknown as GenerateTextFn,
      vi.fn() as unknown as GenerateObjectFn,
      anthropicProviderFactory,
    )
    const onToolCallStart = vi.fn()
    const onToolCallEnd = vi.fn()

    await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      tools: { web_search: { kind: 'native_web_search' } },
      onToolCallStart,
      onToolCallEnd,
      retries: 0,
    })

    const { onChunk } = firstOrThrow(streamTextFn.mock.calls)[0]
    onChunk({
      chunk: { type: 'tool-call', toolName: 'web_search', input: { q: 'x' } },
    })
    onChunk({
      chunk: {
        type: 'tool-result',
        toolName: 'web_search',
        input: { q: 'x' },
        output: { results: [] },
      },
    })

    expect(onToolCallStart).toHaveBeenCalledWith({
      name: 'web_search',
      input: { q: 'x' },
    })
    expect(onToolCallEnd).toHaveBeenCalledWith({
      name: 'web_search',
      input: { q: 'x' },
      output: { results: [] },
    })
  })

  it('logs an error surfaced through streamText onError', async () => {
    const streamTextFn = vi.fn().mockReturnValue(fakeStreamResult())
    const logger = createMockLogger()
    const service = new LlmService(
      logger,
      streamTextFn as unknown as StreamTextFn,
      vi.fn() as unknown as GenerateTextFn,
      vi.fn() as unknown as GenerateObjectFn,
      stubAnthropicFactory,
    )

    await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 0,
    })

    // streamText swallows generation errors by default (they surface only via
    // the onError callback, never thrown), so the service must register one and
    // log through it — otherwise a mid-generation provider failure is silent.
    const { onError } = firstOrThrow(streamTextFn.mock.calls)[0]
    expect(typeof onError).toBe('function')
    const boom = new Error('provider exploded mid-generation')
    onError({ error: boom })

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: boom }),
      'streamText error during generation',
    )
  })
})

describe('LlmService.buildToolSet (via streamChatCompletion)', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    process.env.AI_MODELS = 'claude-sonnet-4-6'
    delete process.env.TOGETHER_AI_KEY
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('fires onToolCallStart before execute and onToolCallEnd after with output', async () => {
    const streamTextFn = vi.fn().mockReturnValue(fakeStreamResult())
    const logger = createMockLogger()
    const service = new LlmService(
      logger,
      streamTextFn as unknown as StreamTextFn,
      vi.fn() as unknown as GenerateTextFn,
      vi.fn() as unknown as GenerateObjectFn,
      stubAnthropicFactory,
    )

    const events: Array<{
      phase: 'start' | 'end'
      name: string
      input: unknown
      output?: unknown
    }> = []

    await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 0,
      tools: {
        lookup_voter: {
          description: 'Look up voter',
          inputSchema: z.object({ voterId: z.number() }),
          execute: async (input: unknown) => {
            const { voterId } = input as { voterId: number }
            return Promise.resolve({ id: voterId, name: 'Jane' })
          },
        },
      },
      onToolCallStart: ({ name, input }) => {
        events.push({ phase: 'start', name, input })
      },
      onToolCallEnd: ({ name, input, output }) => {
        events.push({ phase: 'end', name, input, output })
      },
    })

    const passedTools = firstOrThrow(streamTextFn.mock.calls)[0]
      .tools as Record<
      string,
      { execute: (input: unknown) => Promise<unknown> }
    >
    await passedTools.lookup_voter?.execute({ voterId: 7 })

    expect(events).toEqual([
      { phase: 'start', name: 'lookup_voter', input: { voterId: 7 } },
      {
        phase: 'end',
        name: 'lookup_voter',
        input: { voterId: 7 },
        output: { id: 7, name: 'Jane' },
      },
    ])
  })

  it('logs tool execution success with tool name and input preview', async () => {
    const streamTextFn = vi.fn().mockReturnValue(fakeStreamResult())
    const logger = createMockLogger()
    const service = new LlmService(
      logger,
      streamTextFn as unknown as StreamTextFn,
      vi.fn() as unknown as GenerateTextFn,
      vi.fn() as unknown as GenerateObjectFn,
      stubAnthropicFactory,
    )

    await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 0,
      tools: {
        lookup_voter: {
          description: 'Look up voter',
          inputSchema: z.object({ voterId: z.number() }),
          execute: async (input: unknown) => {
            const { voterId } = input as { voterId: number }
            return Promise.resolve({ id: voterId, name: 'Jane' })
          },
        },
      },
    })

    const passedTools = firstOrThrow(streamTextFn.mock.calls)[0]
      .tools as Record<
      string,
      { execute: (input: unknown) => Promise<unknown> }
    >
    const lookupVoterTool = passedTools.lookup_voter
    if (!lookupVoterTool) throw new Error('expected lookup_voter tool')
    const wrapped = lookupVoterTool.execute

    await wrapped({ voterId: 42 })

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'lookup_voter',
        inputPreview: JSON.stringify({ voterId: 42 }),
      }),
      'LLM tool executed',
    )
  })

  it('wraps tool execute() so failures are logged with tool name and input preview', async () => {
    const streamTextFn = vi.fn().mockReturnValue(fakeStreamResult())
    const logger = createMockLogger()
    const service = new LlmService(
      logger,
      streamTextFn as unknown as StreamTextFn,
      vi.fn() as unknown as GenerateTextFn,
      vi.fn() as unknown as GenerateObjectFn,
      stubAnthropicFactory,
    )

    const upstream = new Error('upstream broke')
    await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 0,
      tools: {
        broken_tool: {
          description: 'Always fails',
          inputSchema: z.object({ id: z.number() }),
          execute: () => {
            throw upstream
          },
        },
      },
    })

    const passedTools = firstOrThrow(streamTextFn.mock.calls)[0]
      .tools as Record<
      string,
      { execute: (input: unknown) => Promise<unknown> }
    >
    const brokenTool = passedTools.broken_tool
    if (!brokenTool) throw new Error('expected broken_tool tool')
    const wrapped = brokenTool.execute

    await expect(wrapped({ id: 7 })).rejects.toBe(upstream)

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: upstream,
        toolName: 'broken_tool',
        inputPreview: JSON.stringify({ id: 7 }),
      }),
      'LLM tool execution failed',
    )
  })

  it('produces a safe inputPreview when input contains BigInt', async () => {
    const streamTextFn = vi.fn().mockReturnValue(fakeStreamResult())
    const logger = createMockLogger()
    const service = new LlmService(
      logger,
      streamTextFn as unknown as StreamTextFn,
      vi.fn() as unknown as GenerateTextFn,
      vi.fn() as unknown as GenerateObjectFn,
      stubAnthropicFactory,
    )

    const upstream = new Error('boom')
    await service.streamChatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 0,
      tools: {
        bigint_tool: {
          description: 'BigInt input',
          inputSchema: z.unknown(),
          execute: () => {
            throw upstream
          },
        },
      },
    })

    const passedTools = firstOrThrow(streamTextFn.mock.calls)[0]
      .tools as Record<
      string,
      { execute: (input: unknown) => Promise<unknown> }
    >

    await expect(passedTools.bigint_tool?.execute({ big: 5n })).rejects.toBe(
      upstream,
    )

    const call = firstOrThrow(
      (logger.error as ReturnType<typeof vi.fn>).mock.calls,
    )[0] as {
      inputPreview: string
    }
    expect(typeof call.inputPreview).toBe('string')
    expect(call.inputPreview.length).toBeGreaterThan(0)
  })
})

describe('toModelMessages conversion', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    process.env.AI_MODELS = 'claude-sonnet-4-6'
    delete process.env.TOGETHER_AI_KEY
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('passes a plain user string through to streamText as a ModelMessage', async () => {
    const { service, streamTextFn } = buildStreamService()
    streamTextFn.mockReturnValueOnce(fakeStreamResult())

    await service.streamChatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
      models: ['claude-sonnet-4-6'],
      retries: 0,
    })

    expect(firstOrThrow(streamTextFn.mock.calls)[0].messages).toEqual([
      { role: 'user', content: 'hello' },
    ])
  })

  it('converts user array text parts to AI SDK text parts', async () => {
    const { service, streamTextFn } = buildStreamService()
    streamTextFn.mockReturnValueOnce(fakeStreamResult())

    await service.streamChatCompletion({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: ' world' },
          ],
        },
      ],
      models: ['claude-sonnet-4-6'],
      retries: 0,
    })

    expect(firstOrThrow(streamTextFn.mock.calls)[0].messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'text', text: ' world' },
        ],
      },
    ])
  })

  it('throws when the messages list contains an unsupported role', async () => {
    const { service } = buildStreamService()

    await expect(
      service.streamChatCompletion({
        messages: [
          { role: 'function', name: 'old_fn', content: 'legacy' } as never,
        ],
        models: ['claude-sonnet-4-6'],
        retries: 0,
      }),
    ).rejects.toThrow(
      'Unsupported message role for AI SDK conversion: function',
    )
  })
})

import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
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

const build = (): {
  service: LlmService
  generateText: ReturnType<typeof vi.fn>
  generateObject: ReturnType<typeof vi.fn>
} => {
  const generateText = vi.fn()
  const generateObject = vi.fn()
  const service = new LlmService(
    createMockLogger(),
    vi.fn() as unknown as StreamTextFn,
    generateText as unknown as GenerateTextFn,
    generateObject as unknown as GenerateObjectFn,
    stubAnthropicFactory,
  )
  return { service, generateText, generateObject }
}

describe('LlmService non-streaming (Anthropic via ai SDK)', () => {
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

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(() => build()).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('chatCompletion returns text + tokens from generateText', async () => {
    const { service, generateText } = build()
    generateText.mockResolvedValueOnce({
      text: '  hello  ',
      toolCalls: [],
      totalUsage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
    })

    const result = await service.chatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 0,
    })

    expect(result.content).toBe('hello')
    expect(result.tokens).toBe(10)
    expect(result.model).toBe('claude-sonnet-4-6')
  })

  it('jsonCompletion validates the object against the schema', async () => {
    const { service, generateObject } = build()
    generateObject.mockResolvedValueOnce({
      object: { answer: '42' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })

    const result = await service.jsonCompletion({
      messages: [USER_MSG],
      schema: z.object({ answer: z.string() }),
      models: ['claude-sonnet-4-6'],
      retries: 0,
    })

    expect(result.object).toEqual({ answer: '42' })
    expect(result.tokens).toBe(2)
  })

  it('jsonCompletion forwards maxTokens as maxOutputTokens', async () => {
    const { service, generateObject } = build()
    generateObject.mockResolvedValueOnce({
      object: { answer: '42' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })

    await service.jsonCompletion({
      messages: [USER_MSG],
      schema: z.object({ answer: z.string() }),
      models: ['claude-sonnet-4-6'],
      maxTokens: 200,
      retries: 0,
    })

    expect(generateObject.mock.calls[0]?.[0].maxOutputTokens).toBe(200)
  })

  it('forwards userId as an X-User-Id header on non-streaming calls', async () => {
    const { service, generateText } = build()
    generateText.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })

    await service.chatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      userId: 'user-123',
      retries: 0,
    })

    expect(generateText.mock.calls[0]?.[0].headers).toEqual({
      'X-User-Id': 'user-123',
    })
  })

  it('toolCompletion maps SDK tool calls back to the OpenAI shape', async () => {
    const { service, generateText } = build()
    generateText.mockResolvedValueOnce({
      text: '',
      toolCalls: [
        {
          toolCallId: 'call_1',
          toolName: 'extractLocation',
          input: { city: 'Austin' },
        },
      ],
      totalUsage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
    })

    const result = await service.toolCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 0,
      tools: [
        {
          type: 'function',
          function: {
            name: 'extractLocation',
            description: 'x',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      toolChoice: { type: 'function', function: { name: 'extractLocation' } },
    })

    expect(result.toolCalls?.[0]?.function.name).toBe('extractLocation')
    expect(
      JSON.parse(result.toolCalls?.[0]?.function.arguments ?? '{}'),
    ).toEqual({ city: 'Austin' })
    expect(generateText.mock.calls[0]?.[0].toolChoice).toEqual({
      type: 'tool',
      toolName: 'extractLocation',
    })
  })

  it('falls back to the next model on a transient error', async () => {
    const { service, generateText } = build()
    generateText
      .mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503 }))
      .mockResolvedValueOnce({
        text: 'ok',
        toolCalls: [],
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      })

    const result = await service.chatCompletion({
      messages: [USER_MSG],
      models: ['claude-opus-4-7', 'claude-sonnet-4-6'],
      retries: 0,
    })

    expect(result.model).toBe('claude-sonnet-4-6')
  })

  it('bails immediately on a permanent 4xx error', async () => {
    const { service, generateText } = build()
    generateText.mockRejectedValue(
      Object.assign(new Error('400'), { status: 400 }),
    )

    await expect(
      service.chatCompletion({
        messages: [USER_MSG],
        models: ['claude-sonnet-4-6'],
        retries: 2,
      }),
    ).rejects.toThrow('400')
    expect(generateText).toHaveBeenCalledOnce()
  })

  it('retries transient errors up to the retry count', async () => {
    const { service, generateText } = build()
    generateText
      .mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503 }))
      .mockResolvedValueOnce({
        text: 'ok',
        toolCalls: [],
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      })

    const result = await service.chatCompletion({
      messages: [USER_MSG],
      models: ['claude-sonnet-4-6'],
      retries: 2,
    })

    expect(result.content).toBe('ok')
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('bails immediately on a permanent 4xx ai-SDK APICallError (statusCode)', async () => {
    const { service, generateText } = build()
    generateText.mockRejectedValue(
      Object.assign(new Error('400'), { statusCode: 400 }),
    )

    await expect(
      service.chatCompletion({
        messages: [USER_MSG],
        models: ['claude-sonnet-4-6', 'claude-opus-4-7'],
        retries: 2,
      }),
    ).rejects.toThrow('400')
    expect(generateText).toHaveBeenCalledOnce()
  })
})

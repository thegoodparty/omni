import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { streamText as realStreamText, type LanguageModel } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import {
  LlmService,
  type AgentTraceIdentity,
  type AnthropicProviderFactory,
  type GenerateObjectFn,
  type GenerateTextFn,
  type StreamTextFn,
} from './llm.service'

// A real AI SDK stream behind the real streamText, not a stub: the point is
// that the spans the SDK starts itself reach the exporter carrying the
// attributes Grafana Agent Observability reads. A fake streamText would only
// assert its own opinion of them.

const streamingModel = (text: string) =>
  new MockLanguageModelV3({
    provider: 'anthropic.messages',
    modelId: 'claude-sonnet-4-6',
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({ type: 'text-start', id: 't1' })
          controller.enqueue({ type: 'text-delta', id: 't1', delta: text })
          controller.enqueue({ type: 'text-end', id: 't1' })
          controller.enqueue({
            type: 'finish',
            usage: {
              inputTokens: {
                total: 11,
                noCache: 11,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 7, text: 7, reasoning: 0 },
            },
            finishReason: { unified: 'stop', raw: 'stop' },
          })
          controller.close()
        },
      }),
    }),
  })

describe('LlmService.streamChatCompletion telemetry', () => {
  let exporter: InMemorySpanExporter
  let provider: BasicTracerProvider

  const serviceFor = (model: MockLanguageModelV3) => {
    const anthropicProviderFactory: AnthropicProviderFactory = () => ({
      languageModel: () => model as LanguageModel,
      webSearchTool: () => ({}) as never,
    })
    return new LlmService(
      createMockLogger(),
      realStreamText as StreamTextFn,
      vi.fn() as unknown as GenerateTextFn,
      vi.fn() as unknown as GenerateObjectFn,
      anthropicProviderFactory,
    )
  }

  const drain = async (
    service: LlmService,
    agentTrace?: AgentTraceIdentity,
  ) => {
    const result = await service.streamChatCompletion({
      messages: [{ role: 'user', content: 'Hi' }],
      models: ['claude-sonnet-4-6'],
      retries: 0,
      ...(agentTrace && { agentTrace }),
    })
    for await (const _chunk of result.textStream) {
      // consume the stream so the SDK ends the spans it started
    }
    await result.finalText
  }

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key')
    vi.stubEnv('AI_MODELS', 'claude-sonnet-4-6')
    exporter = new InMemorySpanExporter()
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    trace.setGlobalTracerProvider(provider)
  })

  afterEach(() => {
    trace.disable()
    vi.unstubAllEnvs()
  })

  const generationSpan = () =>
    firstOrThrow(
      exporter
        .getFinishedSpans()
        .filter((s) => s.attributes['gen_ai.operation.name'] === 'chat'),
    )

  it('sends a generation to Agent Observability under the chat scope', async () => {
    await drain(serviceFor(streamingModel('hello')), {
      conversationId: 'conv-1',
      agentName: 'chief_of_staff',
    })

    expect(generationSpan().attributes).toMatchObject({
      'agento11y.record': true,
      'gen_ai.conversation.id': 'conv-1',
      'gen_ai.agent.name': 'chief_of_staff',
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'anthropic',
      'gen_ai.request.model': 'claude-sonnet-4-6',
      'gen_ai.usage.input_tokens': 11,
      'gen_ai.usage.output_tokens': 7,
    })
  })

  it('records no prompt or reply text, because prompts carry voter data', async () => {
    await drain(serviceFor(streamingModel('a campaign secret')), {
      conversationId: 'conv-1',
      agentName: 'campaign_assistant',
    })

    for (const span of exporter.getFinishedSpans()) {
      expect(span.attributes).not.toHaveProperty('gen_ai.input.messages')
      expect(span.attributes).not.toHaveProperty('gen_ai.output.messages')
      expect(span.attributes).not.toHaveProperty('ai.prompt')
      expect(span.attributes).not.toHaveProperty('ai.prompt.messages')
    }
    const attributes = exporter
      .getFinishedSpans()
      .map((s) => JSON.stringify(s.attributes))
      .join()
    expect(attributes).not.toContain('a campaign secret')
  })

  it('leaves a call with no chat scope as a plain Tempo trace', async () => {
    await drain(serviceFor(streamingModel('hello')))

    for (const span of exporter.getFinishedSpans()) {
      expect(span.attributes).not.toHaveProperty('agento11y.record')
      expect(span.attributes).not.toHaveProperty('gen_ai.conversation.id')
    }
  })
})

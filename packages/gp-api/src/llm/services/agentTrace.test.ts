import { ROOT_CONTEXT, trace, type Tracer } from '@opentelemetry/api'
import { beforeEach, describe, expect, it } from 'vitest'
import { agentTraceTracer } from './agentTrace'

const identity = {
  conversationId: 'conv-1',
  agentName: 'chief_of_staff',
}

type Recorded = { name: string; attributes: Record<string, unknown> }

const recording = () => {
  const spans: Recorded[] = []
  const delegate: Tracer = {
    startSpan: (name, options) => {
      spans.push({ name, attributes: { ...options?.attributes } })
      return {} as never
    },
    startActiveSpan: (name: string, ...rest: unknown[]) => {
      const options =
        typeof rest[0] === 'object' ? (rest[0] as { attributes?: object }) : {}
      spans.push({ name, attributes: { ...options.attributes } })
      const fn = rest.find((a) => typeof a === 'function') as (
        span: unknown,
      ) => unknown
      return fn({})
    },
  } as Tracer
  return { spans, delegate }
}

describe('agentTraceTracer', () => {
  let recorded: ReturnType<typeof recording>

  beforeEach(() => {
    recorded = recording()
  })

  it('marks every span as recorded and groups it under the conversation', () => {
    const tracer = agentTraceTracer(identity, recorded.delegate)

    tracer.startSpan('ai.streamText.doStream', {
      attributes: {
        'gen_ai.system': 'anthropic.messages',
        'gen_ai.request.model': 'claude-sonnet-4-6',
      },
    })

    expect(recorded.spans[0]?.attributes).toMatchObject({
      'agento11y.record': true,
      'gen_ai.conversation.id': 'conv-1',
      'gen_ai.agent.name': 'chief_of_staff',
      'gen_ai.request.model': 'claude-sonnet-4-6',
    })
  })

  it('names a model call as a chat generation for its provider', () => {
    const tracer = agentTraceTracer(identity, recorded.delegate)

    tracer.startSpan('ai.streamText.doStream', {
      attributes: { 'gen_ai.system': 'anthropic.messages' },
    })

    expect(recorded.spans[0]?.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'anthropic',
    })
  })

  it('names a tool call as its own operation and carries no arguments', () => {
    const tracer = agentTraceTracer(identity, recorded.delegate)

    tracer.startSpan('ai.toolCall', {
      attributes: {
        'ai.toolCall.name': 'queryVoters',
        'ai.toolCall.args': '{"state":"CA"}',
      },
    })

    expect(recorded.spans[0]?.attributes).toMatchObject({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'queryVoters',
      'ai.toolCall.args': '{"state":"CA"}',
    })
    expect(recorded.spans[0]?.attributes).not.toHaveProperty(
      'gen_ai.tool.arguments',
    )
  })

  it('names the surrounding step as the agent invocation', () => {
    const tracer = agentTraceTracer(identity, recorded.delegate)

    tracer.startSpan('ai.streamText', {
      attributes: { 'ai.model.provider': 'anthropic.messages' },
    })

    expect(recorded.spans[0]?.attributes).toMatchObject({
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.provider.name': 'anthropic',
    })
  })

  it('leaves an operation the caller already named alone', () => {
    const tracer = agentTraceTracer(identity, recorded.delegate)

    tracer.startSpan('ai.streamText', {
      attributes: {
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.provider.name': 'anthropic',
      },
    })

    expect(recorded.spans[0]?.attributes['gen_ai.operation.name']).toBe(
      'invoke_agent',
    )
  })

  it('reaches spans the SDK starts on its own through startActiveSpan', () => {
    const tracer = agentTraceTracer(identity, recorded.delegate)

    tracer.startActiveSpan('ai.streamText', {}, () => 'ok')

    expect(recorded.spans[0]).toMatchObject({
      name: 'ai.streamText',
      attributes: {
        'agento11y.record': true,
        'gen_ai.conversation.id': 'conv-1',
      },
    })
  })

  it('wraps the SDK default tracer when none is supplied', () => {
    const tracer = agentTraceTracer(identity)

    expect(tracer).not.toBe(trace.getTracer('ai'))
    expect(typeof tracer.startSpan).toBe('function')
    expect(() => tracer.startSpan('ai.streamText', undefined, ROOT_CONTEXT)).not
      .toThrow
  })
})
